"""
Converts model logits into protocol response messages.
Used during both inference (acting in the environment) and evaluation.
Log-probability computation for training lives in the PPO module, not here.
"""

import torch
from .encoder import (
    MAX_PLAYERS, MAX_SURVIVORS, LOCATION_IDS, RESOURCE_TYPES,
    MAX_DRAFT_POOL, Masks,
)
from .model import (
    ACT_REST, ACT_DEFEND, ACT_SCAV_START, ACT_SCAV_END,
    ACT_ATTACK_START, N_SURVIVOR_ACTIONS, MAX_LOOT_TOKENS,
)

NEG_INF = float("-inf")


def _masked_sample(logits: torch.Tensor, mask: torch.Tensor) -> int:
    """Sample an index from logits, zeroing out masked positions."""
    masked = logits.clone()
    masked[~mask] = NEG_INF
    probs = torch.softmax(masked, dim=-1)
    return torch.multinomial(probs, 1).item()


def _masked_argmax(logits: torch.Tensor, mask: torch.Tensor) -> int:
    masked = logits.clone()
    masked[~mask] = NEG_INF
    return masked.argmax().item()


def decode_draft(
    logits: torch.Tensor,
    masks: Masks,
    state: dict,
    player_id: str,
    game_id: str,
    sample: bool = True,
) -> dict:
    pool = sorted(state["draftPool"], key=lambda s: s["id"])
    idx  = _masked_sample(logits, masks.draft_pool) if sample else _masked_argmax(logits, masks.draft_pool)
    return {
        "type":       "draft_response",
        "gameId":     game_id,
        "playerId":   player_id,
        "survivorId": pool[idx]["id"],
    }


def decode_actions(
    logits: torch.Tensor,
    masks: Masks,
    state: dict,
    player_id: str,
    game_id: str,
    sample: bool = True,
) -> dict:
    player    = next(p for p in state["players"] if p["id"] == player_id)
    players   = state["players"]
    survivors = [s for s in player["survivors"] if s["alive"]]

    intents = []
    for sv_local_idx, sv in enumerate(survivors):
        # Find this survivor's slot in the fixed MAX_SURVIVORS ordering
        sv_slot = next(
            (i for i, s in enumerate(player["survivors"]) if s["id"] == sv["id"]),
            sv_local_idx,
        )
        sv_slot = min(sv_slot, MAX_SURVIVORS - 1)

        sv_logits = logits[sv_slot].clone()

        # Build valid-action mask for this survivor
        sv_mask = torch.zeros(N_SURVIVOR_ACTIONS, dtype=torch.bool)
        sv_mask[ACT_REST]   = True
        sv_mask[ACT_DEFEND] = True
        sv_mask[ACT_SCAV_START:ACT_SCAV_END] = masks.locations
        sv_mask[ACT_ATTACK_START:ACT_ATTACK_START + MAX_PLAYERS] = masks.opponents

        act_idx = _masked_sample(sv_logits, sv_mask) if sample else _masked_argmax(sv_logits, sv_mask)

        if act_idx == ACT_REST:
            action = {"type": "rest"}
        elif act_idx == ACT_DEFEND:
            action = {"type": "defend"}
        elif ACT_SCAV_START <= act_idx < ACT_SCAV_END:
            action = {"type": "scavenge", "locationId": LOCATION_IDS[act_idx - ACT_SCAV_START]}
        else:
            target_idx = act_idx - ACT_ATTACK_START
            action = {"type": "attack", "targetPlayerId": players[target_idx]["id"]}

        intents.append({"survivorId": sv["id"], "action": action})

    return {
        "type":      "action_response",
        "gameId":    game_id,
        "playerId":  player_id,
        "intents":   intents,
    }


def decode_loot(
    logits: torch.Tensor,
    masks: Masks,
    state: dict,
    player_id: str,
    game_id: str,
    loot_id: str,
    sample: bool = True,
) -> dict:
    opp      = next(o for o in state["lootOpportunities"] if o["id"] == loot_id)
    tokens   = opp["revealedTokens"]
    capacity = opp["carryCapacity"]

    # Resources are free — always take them.
    # Items compete for carry slots — rank by logit score, take top-capacity.
    chosen          = []
    item_candidates = []

    for i, token in enumerate(tokens[:MAX_LOOT_TOKENS]):
        if token["kind"] == "resource":
            chosen.append(i)
        elif token["kind"] != "nothing":
            item_candidates.append((logits[i].item(), i))

    item_candidates.sort(reverse=True)
    for _, i in item_candidates[:capacity]:
        chosen.append(i)

    return {
        "type":         "loot_response",
        "gameId":       game_id,
        "playerId":     player_id,
        "lootId":       loot_id,
        "tokenIndices": chosen,
    }


def decode_upkeep(
    upkeep_logits: torch.Tensor,
    med_logits: torch.Tensor,
    state: dict,
    player_id: str,
    game_id: str,
    sample: bool = True,
) -> dict:
    player    = next(p for p in state["players"] if p["id"] == player_id)
    survivors = [s for s in player["survivors"] if s["alive"]]
    res       = player["compound"]["resources"]

    food  = res["food"]
    water = res["water"]
    meds  = res["meds"]

    CHOICES    = ["food", "water", "none"]
    sustenance = {}
    med_heals  = []

    for i, sv in enumerate(survivors[:MAX_SURVIVORS]):
        sv_logits = upkeep_logits[i].clone()
        if food  <= 0: sv_logits[0] = NEG_INF
        if water <= 0: sv_logits[1] = NEG_INF

        choice_mask = sv_logits != NEG_INF
        choice_idx  = _masked_sample(sv_logits, choice_mask) if sample else _masked_argmax(sv_logits, choice_mask)
        choice      = CHOICES[choice_idx]

        sustenance[sv["id"]] = choice
        if choice == "food":  food  -= 1
        if choice == "water": water -= 1

        if meds > 0 and sv["hp"] < sv["maxHp"] and med_logits[i].item() > 0:
            med_heals.append(sv["id"])
            meds -= 1

    return {
        "type":      "upkeep_response",
        "gameId":    game_id,
        "playerId":  player_id,
        "allocations": {"sustenance": sustenance, "medHeals": med_heals},
    }
