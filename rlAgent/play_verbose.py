"""
Play one game with the trained model and save a detailed JSON log.
Usage:
  python play_verbose.py                          # random init model
  python play_verbose.py --checkpoint checkpoints/model_update_0025.pt
Log is saved to game-logs/verbose_<timestamp>.json
"""

import argparse
import json
import os
import torch
from datetime import datetime

from agent.client import GameClient
from agent.encoder import encode, LOCATION_IDS, MAX_SURVIVORS
from agent.model import ActorCritic, ACT_SCAV_START, ACT_SCAV_END, ACT_ATTACK_START
from agent.decoder import decode_loot
from train import _sample, _player_idx, _survivor_action_mask, compute_rewards, NEG_INF

SERVER_CMD  = "npx ts-node ../gameBackend/src/server/index.ts"
LOG_DIR     = "game-logs"


# ─────────────────────────────────────────────────────────────────────────────
# Slim state snapshot — extract just what's useful for analysis
# ─────────────────────────────────────────────────────────────────────────────

def _player_snapshot(player: dict) -> dict:
    return {
        "id":        player["id"],
        "name":      player["name"],
        "eliminated": player["isEliminated"],
        "resources": player["compound"]["resources"],
        "structures": [s["id"] for s in player["compound"].get("structures", [])],
        "survivors": [
            {
                "name":      sv["name"],
                "alive":     sv["alive"],
                "hp":        sv["hp"],
                "maxHp":     sv["maxHp"],
                "threat":    sv["baseThreat"],
                "debuffs":   sv.get("debuffs", []),
                "items":     [
                    (t.get("weaponId") or t.get("equipmentId") or t["kind"])
                    for t in sv.get("equippedItems", []) if t and t.get("kind") != "nothing"
                ],
            }
            for sv in player.get("survivors", [])
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Game loop — mirrors train.py but records everything
# ─────────────────────────────────────────────────────────────────────────────

def play_verbose(model: ActorCritic, checkpoint_path: str | None) -> dict:
    client = GameClient(SERVER_CMD)

    log = {
        "metadata": {
            "timestamp":  datetime.now().isoformat(),
            "checkpoint": checkpoint_path or "none (random init)",
        },
        "draft_sequence": [],
        "rounds":         [],
        "events":         [],
        "final_players":  [],
        "winner_id":      None,
        "winner_name":    None,
        "total_rounds":   0,
    }

    current_round_actions: dict[str, list] = {}

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
                log["metadata"]["game_id"] = game_id
                continue

            if t == "game_over":
                winner_id   = msg["winnerId"]
                final_state = state
                log["winner_id"]    = winner_id
                log["winner_name"]  = next((p["name"] for p in state["players"] if p["id"] == winner_id), None)
                log["total_rounds"] = state.get("round", 0)
                log["events"]       = state.get("events", [])
                log["final_players"] = [_player_snapshot(p) for p in state.get("players", [])]
                break

            obs, masks = encode(state, player_id)

            with torch.no_grad():
                out = model(obs.unsqueeze(0))

            # ── Draft ──────────────────────────────────────────────────────────
            if t == "draft_request":
                idx, _  = _sample(out["draft"].squeeze(0), masks.draft_pool)
                pool    = sorted(state["draftPool"], key=lambda s: s["id"])
                pick    = pool[idx]
                response = {
                    "type": "draft_response", "gameId": game_id,
                    "playerId": player_id, "survivorId": pick["id"],
                }
                player_name = next(p["name"] for p in state["players"] if p["id"] == player_id)
                log["draft_sequence"].append({
                    "player_id":   player_id,
                    "player_name": player_name,
                    "survivor":    pick["id"],
                    "maxHp":       pick["maxHp"],
                    "baseThreat":  pick["baseThreat"],
                })

            # ── Action selection ───────────────────────────────────────────────
            elif t == "action_request":
                player        = next(p for p in state["players"] if p["id"] == player_id)
                survivors     = player["survivors"]
                sv_mask       = _survivor_action_mask(masks.locations, masks.opponents)
                action_logits = out["action"].squeeze(0)
                intents       = []
                action_log    = []

                for sv_slot, sv in enumerate(survivors[:MAX_SURVIVORS]):
                    if not sv["alive"]:
                        continue
                    act_idx, _ = _sample(action_logits[sv_slot], sv_mask)

                    if act_idx == 0:
                        action = {"type": "rest"}
                    elif act_idx == 1:
                        action = {"type": "defend"}
                    elif ACT_SCAV_START <= act_idx < ACT_SCAV_END:
                        action = {"type": "scavenge", "locationId": LOCATION_IDS[act_idx - ACT_SCAV_START]}
                    else:
                        target = state["players"][act_idx - ACT_ATTACK_START]
                        action = {"type": "attack", "targetPlayerId": target["id"]}

                    intents.append({"survivorId": sv["id"], "action": action})
                    action_log.append({"survivor": sv["name"], "action": action})

                response = {
                    "type": "action_response", "gameId": game_id,
                    "playerId": player_id, "intents": intents,
                }

                round_num = state.get("round", 0)
                if round_num not in current_round_actions:
                    current_round_actions[round_num] = {}
                current_round_actions[round_num][player_id] = {
                    "player_name": player["name"],
                    "actions":     action_log,
                    "resources":   player["compound"]["resources"].copy(),
                    "alive_survivors": sum(1 for sv in survivors if sv["alive"]),
                }

            # ── Loot (greedy) ──────────────────────────────────────────────────
            elif t == "loot_request":
                response = decode_loot(
                    out["loot"].squeeze(0), masks, state, player_id, game_id, msg["lootId"]
                )

            # ── Upkeep ─────────────────────────────────────────────────────────
            elif t == "upkeep_request":
                player        = next(p for p in state["players"] if p["id"] == player_id)
                survivors     = player["survivors"]
                res           = player["compound"]["resources"]
                upkeep_logits = out["upkeep"].squeeze(0)
                food, water   = res["food"], res["water"]
                sustenance    = {}

                CHOICES = ["food", "water", "none"]
                for sv_slot, sv in enumerate(survivors[:MAX_SURVIVORS]):
                    if not sv["alive"]:
                        continue
                    logit_sv = upkeep_logits[sv_slot].clone()
                    if food  <= 0: logit_sv[0] = NEG_INF
                    if water <= 0: logit_sv[1] = NEG_INF
                    valid = logit_sv != NEG_INF
                    if not valid.any(): valid[2] = True
                    choice_idx, _ = _sample(logit_sv, valid)
                    choice = CHOICES[choice_idx]
                    sustenance[sv["id"]] = choice
                    if choice == "food":  food  -= 1
                    if choice == "water": water -= 1

                response = {
                    "type": "upkeep_response", "gameId": game_id,
                    "playerId": player_id,
                    "allocations": {"sustenance": sustenance, "medHeals": []},
                }

            else:
                continue

            client.send(response)

    finally:
        client.close()

    # Flatten round actions into ordered list
    for round_num in sorted(current_round_actions):
        log["rounds"].append({
            "round":   round_num,
            "players": current_round_actions[round_num],
        })

    return log


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=str, default=None)
    args = parser.parse_args()

    model = ActorCritic()
    if args.checkpoint:
        data = torch.load(args.checkpoint, map_location="cpu")
        model.load_state_dict(data["model"])
        trained_on = data.get("update", "?")
        print(f"Loaded checkpoint: {args.checkpoint} (update {trained_on})")
    else:
        print("No checkpoint — using random init model")

    model.eval()
    print("Playing game...")
    log = play_verbose(model, args.checkpoint)

    os.makedirs(LOG_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(LOG_DIR, f"verbose_{timestamp}.json")
    with open(path, "w") as f:
        json.dump(log, f, indent=2)

    print(f"Winner: {log['winner_name']} after {log['total_rounds']} rounds")
    print(f"Log saved -> {path}")
