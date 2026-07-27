"""
Main training loop.
Plays games against the TS server, collects experience, runs PPO updates.
Run from the rlAgent/ directory: python train.py
"""

import os
import torch

from agent.client import GameClient
from agent.encoder import encode, LOCATION_IDS, MAX_SURVIVORS
from agent.model import ActorCritic, N_SURVIVOR_ACTIONS, ACT_SCAV_START, ACT_SCAV_END, ACT_ATTACK_START
from agent.decoder import decode_loot
from training.rollout import Step, RolloutBuffer
from training.ppo import ppo_update, _survivor_action_mask

SERVER_CMD         = "npx ts-node ../gameBackend/src/server/index.ts"
CHECKPOINT_DIR     = "checkpoints"
N_GAMES_PER_UPDATE = 20
N_EPOCHS           = 4
MINIBATCH_SIZE     = 64
LR                 = 3e-4
SAVE_EVERY         = 25   # save checkpoint every N updates

NEG_INF = float("-inf")


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _sample(logits: torch.Tensor, mask: torch.Tensor) -> tuple[int, float]:
    """Sample from masked categorical. Returns (index, log_prob)."""
    masked       = logits.clone()
    masked[~mask] = NEG_INF
    probs        = torch.softmax(masked, dim=-1)
    idx          = torch.multinomial(probs, 1).item()
    log_p        = torch.log_softmax(masked, dim=-1)[idx].item()
    return idx, log_p


def _player_idx(state: dict, player_id: str) -> int:
    return next(i for i, p in enumerate(state["players"]) if p["id"] == player_id)


def compute_rewards(final_state: dict, winner_id: str | None) -> dict[int, float]:
    """Zero-sum: winner +1, each loser shares -1."""
    players = final_state["players"]
    n       = len(players)
    return {
        i: (1.0 if p["id"] == winner_id else -1.0 / (n - 1))
        for i, p in enumerate(players)
    }


# ─────────────────────────────────────────────────────────────────────────────
# Game loop
# ─────────────────────────────────────────────────────────────────────────────

def play_game(model: ActorCritic, buffer: RolloutBuffer) -> str | None:
    client  = GameClient(SERVER_CMD)
    winner  = None
    buffer.start_episode()

    try:
        while True:
            msg = client.recv()
            if msg is None:
                break

            t         = msg["type"]
            player_id = msg.get("playerId")
            state     = msg.get("state", {})
            game_id   = msg.get("gameId")

            if t == "game_start":
                continue

            if t == "game_over":
                winner  = msg["winnerId"]
                buffer.finish_episode(compute_rewards(state, winner))
                break

            obs, masks = encode(state, player_id)
            p_idx      = _player_idx(state, player_id)

            with torch.no_grad():
                out = model(obs.unsqueeze(0))

            value = out["value"].squeeze().item()

            # ── Draft ──────────────────────────────────────────────────────────
            if t == "draft_request":
                idx, log_p = _sample(out["draft"].squeeze(0), masks.draft_pool)
                pool       = sorted(state["draftPool"], key=lambda s: s["id"])
                response   = {
                    "type": "draft_response", "gameId": game_id,
                    "playerId": player_id, "survivorId": pool[idx]["id"],
                }
                buffer.add(Step(
                    obs=obs, masks=masks, phase="draft", player_idx=p_idx,
                    draft_idx=idx, log_prob=log_p, value=value,
                ))

            # ── Action selection ───────────────────────────────────────────────
            elif t == "action_request":
                player        = next(p for p in state["players"] if p["id"] == player_id)
                survivors     = player["survivors"]
                sv_mask       = _survivor_action_mask(masks.locations, masks.opponents)
                action_logits = out["action"].squeeze(0)
                intents       = []
                survivor_acts = []
                total_log_p   = 0.0

                for sv_slot, sv in enumerate(survivors[:MAX_SURVIVORS]):
                    if not sv["alive"]:
                        continue
                    act_idx, lp = _sample(action_logits[sv_slot], sv_mask)
                    total_log_p += lp
                    survivor_acts.append((sv_slot, act_idx))

                    if act_idx == 0:
                        action = {"type": "rest"}
                    elif act_idx == 1:
                        action = {"type": "defend"}
                    elif ACT_SCAV_START <= act_idx < ACT_SCAV_END:
                        action = {"type": "scavenge", "locationId": LOCATION_IDS[act_idx - ACT_SCAV_START]}
                    else:
                        target_player = state["players"][act_idx - ACT_ATTACK_START]
                        action = {"type": "attack", "targetPlayerId": target_player["id"]}

                    intents.append({"survivorId": sv["id"], "action": action})

                response = {
                    "type": "action_response", "gameId": game_id,
                    "playerId": player_id, "intents": intents,
                }
                buffer.add(Step(
                    obs=obs, masks=masks, phase="action_selection", player_idx=p_idx,
                    survivor_acts=survivor_acts, log_prob=total_log_p, value=value,
                ))

            # ── Planning (sustenance — trained via upkeep head) ────────────────
            elif t == "planning_request":
                player        = next(p for p in state["players"] if p["id"] == player_id)
                survivors     = player["survivors"]
                res           = player["compound"]["resources"]
                upkeep_logits = out["upkeep"].squeeze(0)
                food, water   = res["food"], res["water"]
                sustenance    = {}
                upkeep_acts   = []
                total_log_p   = 0.0

                CHOICES = ["food", "water", "none"]
                for sv_slot, sv in enumerate(survivors[:MAX_SURVIVORS]):
                    if not sv["alive"]:
                        continue
                    logit_sv = upkeep_logits[sv_slot].clone()
                    if food  <= 0: logit_sv[0] = NEG_INF
                    if water <= 0: logit_sv[1] = NEG_INF

                    valid = logit_sv != NEG_INF
                    if not valid.any():
                        valid[2] = True  # always allow 'none'

                    choice_idx, lp = _sample(logit_sv, valid)
                    total_log_p   += lp
                    upkeep_acts.append((sv_slot, choice_idx))

                    choice = CHOICES[choice_idx]
                    sustenance[sv["id"]] = choice
                    if choice == "food":  food  -= 1
                    if choice == "water": water -= 1

                response = {
                    "type": "planning_response", "gameId": game_id,
                    "playerId": player_id,
                    "allocations": {"sustenance": sustenance},
                }
                buffer.add(Step(
                    obs=obs, masks=masks, phase="planning", player_idx=p_idx,
                    upkeep_acts=upkeep_acts, log_prob=total_log_p, value=value,
                ))

            # ── Loot (greedy — not a trained decision) ─────────────────────────
            elif t == "loot_request":
                response = decode_loot(
                    out["loot"].squeeze(0), masks, state, player_id, game_id, msg["lootId"]
                )

            # ── Upkeep (med heals only — greedy, not trained) ──────────────────
            elif t == "upkeep_request":
                response = {
                    "type": "upkeep_response", "gameId": game_id,
                    "playerId": player_id,
                    "allocations": {"medHeals": []},
                }

            else:
                continue

            client.send(response)

    finally:
        client.close()

    return winner


# ─────────────────────────────────────────────────────────────────────────────
# Training loop
# ─────────────────────────────────────────────────────────────────────────────

def _latest_checkpoint() -> str | None:
    if not os.path.isdir(CHECKPOINT_DIR):
        return None
    pts = sorted(f for f in os.listdir(CHECKPOINT_DIR) if f.endswith(".pt"))
    return os.path.join(CHECKPOINT_DIR, pts[-1]) if pts else None


def train():
    os.makedirs(CHECKPOINT_DIR, exist_ok=True)

    model     = ActorCritic()
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    buffer    = RolloutBuffer(gamma=1.0, gae_lambda=0.95)

    update      = 0
    total_games = 0

    ckpt_path = _latest_checkpoint()
    if ckpt_path:
        ckpt        = torch.load(ckpt_path, weights_only=True)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        update      = ckpt["update"]
        total_games = update * N_GAMES_PER_UPDATE
        print(f"Resumed from {ckpt_path} (update {update}, {total_games} games)", flush=True)

    print(f"Parameters : {sum(p.numel() for p in model.parameters()):,}", flush=True)
    print(f"Games/update: {N_GAMES_PER_UPDATE}  |  Epochs: {N_EPOCHS}  |  LR: {LR}\n", flush=True)
    print(f"{'Update':>6}  {'Games':>6}  {'Steps':>6}  {'Win%':>5}  {'PolLoss':>8}  {'ValLoss':>8}  {'Entropy':>8}", flush=True)
    print("-" * 66, flush=True)
    while True:
        update      += 1
        total_games += N_GAMES_PER_UPDATE
        win_counts: dict[str, int] = {}
        model.eval()

        for _ in range(N_GAMES_PER_UPDATE):
            winner = play_game(model, buffer)
            key    = winner or "none"
            win_counts[key] = win_counts.get(key, 0) + 1

        steps_collected = len(buffer)
        model.train()
        stats = ppo_update(model, optimizer, buffer, n_epochs=N_EPOCHS, minibatch_size=MINIBATCH_SIZE)
        buffer.clear()

        # No single "winner" in self-play — track how spread the wins are
        top_wins   = max(win_counts.values()) if win_counts else 0
        win_pct    = 100 * top_wins / N_GAMES_PER_UPDATE

        print(
            f"{update:>6}  {total_games:>6}  {steps_collected:>6}  {win_pct:>4.0f}%"
            f"  {stats['policy_loss']:>+8.4f}  {stats['value_loss']:>8.4f}  {stats['entropy']:>8.4f}",
            flush=True,
        )

        if update % SAVE_EVERY == 0:
            path = os.path.join(CHECKPOINT_DIR, f"model_update_{update:04d}.pt")
            torch.save({"update": update, "model": model.state_dict(), "optimizer": optimizer.state_dict()}, path)
            print(f"  -> saved {path}", flush=True)


if __name__ == "__main__":
    train()
