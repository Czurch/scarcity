"""
Converts a GameState dict (from the server's JSON) into a fixed-size float tensor
the neural network can consume, plus boolean masks indicating which action slots are valid.

Observation vector layout (897 values total):
  [0:6]    phase one-hot
  [6:7]    round (normalized)
  [7:615]  4 players × 152 values each
  [615:804] 9 locations × 21 values each
  [804:876] 24 draft pool slots × 3 values each
  [876:897] current loot opportunity (21 values)
"""

import torch
from typing import NamedTuple

# ─────────────────────────────────────────────────────────────────────────────
# Fixed game constants — must match types.ts
# ─────────────────────────────────────────────────────────────────────────────

PHASES         = ["draft", "action_selection", "conflict_resolution", "looting", "upkeep", "game_over"]
RESOURCE_TYPES = ["water", "food", "meds", "wood", "metal", "ammo"]
WEAPON_IDS     = ["wooden_club", "lead_pipe", "sawbat", "pipe_gun", "handgun", "snubnose", "rifle"]
EQUIPMENT_IDS  = ["backpack", "hand_cart", "armor", "radio", "jammer", "flashlight"]
STRUCTURE_IDS  = ["bunk", "spike_trap", "spring_trap", "ramparts", "electric_fence_alarm", "rain_catch", "small_garden"]
LOCATION_IDS   = ["mini_mart", "police_station", "reservoir", "mall", "hospital", "woods", "commercial", "residential", "grocery"]

MAX_PLAYERS    = 4
MAX_SURVIVORS  = 4
MAX_DRAFT_POOL = 24
ITEM_SLOTS     = 2
N_ITEM_TYPES   = len(WEAPON_IDS) + len(EQUIPMENT_IDS) + 1  # 14 (last slot = "none")

# Section sizes
SURVIVOR_SIZE   = 6 + ITEM_SLOTS * N_ITEM_TYPES             # 34
PLAYER_SIZE     = 2 + len(RESOURCE_TYPES) + len(STRUCTURE_IDS) + 1 + MAX_SURVIVORS * SURVIVOR_SIZE  # 152
LOCATION_SIZE   = 1 + len(RESOURCE_TYPES) + len(WEAPON_IDS) + len(EQUIPMENT_IDS) + 1               # 21
DRAFT_SLOT_SIZE = 3
LOOT_SIZE       = len(RESOURCE_TYPES) + len(WEAPON_IDS) + len(EQUIPMENT_IDS) + 1 + 1               # 21

OBS_SIZE = (
    len(PHASES)
    + 1
    + MAX_PLAYERS * PLAYER_SIZE
    + len(LOCATION_IDS) * LOCATION_SIZE
    + MAX_DRAFT_POOL * DRAFT_SLOT_SIZE
    + LOOT_SIZE
)  # 897


# ─────────────────────────────────────────────────────────────────────────────
# Masks — tell the model which action slots are actually valid this turn
# ─────────────────────────────────────────────────────────────────────────────

class Masks(NamedTuple):
    survivors:  torch.Tensor  # [MAX_PLAYERS, MAX_SURVIVORS] — alive and not on eliminated team
    locations:  torch.Tensor  # [len(LOCATION_IDS)]          — location has cards remaining
    draft_pool: torch.Tensor  # [MAX_DRAFT_POOL]             — slot is in the current pool
    opponents:  torch.Tensor  # [MAX_PLAYERS]                — valid attack targets


# ─────────────────────────────────────────────────────────────────────────────
# Section encoders
# ─────────────────────────────────────────────────────────────────────────────

def _encode_item(item: dict | None) -> list:
    vec = [0.0] * N_ITEM_TYPES
    if item is None:
        vec[-1] = 1.0
    elif item["kind"] == "weapon":
        vec[WEAPON_IDS.index(item["weaponId"])] = 1.0
    elif item["kind"] == "equipment":
        vec[len(WEAPON_IDS) + EQUIPMENT_IDS.index(item["equipmentId"])] = 1.0
    return vec


def _encode_survivor(sv: dict) -> list:
    alive    = float(sv["alive"])
    hp_ratio = (sv["hp"] / sv["maxHp"]) if sv["maxHp"] > 0 else 0.0
    max_hp   = sv["maxHp"] / 5.0
    threat   = sv["baseThreat"] / 10.0
    starving = float("starving" in sv.get("debuffs", []))
    well_fed = float(sv.get("wellFed", False))

    items = list(sv.get("equippedItems", []))
    while len(items) < ITEM_SLOTS:
        items.append(None)

    item_vec = []
    for slot in items[:ITEM_SLOTS]:
        item_vec.extend(_encode_item(slot))

    return [alive, hp_ratio, max_hp, threat, starving, well_fed] + item_vec


def _encode_player(player: dict) -> list:
    vec = [float(player["isEliminated"]), float(player["intentsSubmitted"])]

    res = player["compound"]["resources"]
    vec.extend(res.get(r, 0) / 30.0 for r in RESOURCE_TYPES)

    built = {s["id"] for s in player["compound"].get("structures", [])}
    vec.extend(float(sid in built) for sid in STRUCTURE_IDS)

    vec.append(player["compound"].get("structureThreat", 0) / 10.0)

    survivors = player.get("survivors", [])
    for i in range(MAX_SURVIVORS):
        if i < len(survivors):
            vec.extend(_encode_survivor(survivors[i]))
        else:
            vec.extend([0.0] * SURVIVOR_SIZE)

    return vec


def _encode_location(loc: dict) -> list:
    deck = loc.get("lootDeck", [])

    res_counts    = [0] * len(RESOURCE_TYPES)
    weapon_counts = [0] * len(WEAPON_IDS)
    equip_counts  = [0] * len(EQUIPMENT_IDS)
    nothing_count = 0

    for token in deck:
        kind = token["kind"]
        if kind == "resource":
            res_counts[RESOURCE_TYPES.index(token["resource"])] += 1
        elif kind == "weapon":
            weapon_counts[WEAPON_IDS.index(token["weaponId"])] += 1
        elif kind == "equipment":
            equip_counts[EQUIPMENT_IDS.index(token["equipmentId"])] += 1
        elif kind == "nothing":
            nothing_count += 1

    return (
        [len(deck) / 30.0]
        + [c / 30.0 for c in res_counts]
        + [c / 10.0 for c in weapon_counts]
        + [c / 10.0 for c in equip_counts]
        + [nothing_count / 10.0]
    )


def _encode_draft_pool(state: dict) -> list:
    pool = sorted(state.get("draftPool", []), key=lambda s: s["id"])
    vec = []
    for i in range(MAX_DRAFT_POOL):
        if i < len(pool):
            sv = pool[i]
            vec.extend([1.0, sv["maxHp"] / 5.0, sv["baseThreat"] / 10.0])
        else:
            vec.extend([0.0, 0.0, 0.0])
    return vec


def _encode_loot(state: dict, player_id: str | None) -> list:
    opp = None
    if player_id is not None:
        opp = next(
            (o for o in state.get("lootOpportunities", [])
             if o["playerId"] == player_id and not o["claimed"]),
            None,
        )

    if opp is None:
        return [0.0] * LOOT_SIZE

    res_counts    = [0] * len(RESOURCE_TYPES)
    weapon_counts = [0] * len(WEAPON_IDS)
    equip_counts  = [0] * len(EQUIPMENT_IDS)
    nothing_count = 0

    for token in opp.get("revealedTokens", []):
        kind = token["kind"]
        if kind == "resource":
            res_counts[RESOURCE_TYPES.index(token["resource"])] += 1
        elif kind == "weapon":
            weapon_counts[WEAPON_IDS.index(token["weaponId"])] += 1
        elif kind == "equipment":
            equip_counts[EQUIPMENT_IDS.index(token["equipmentId"])] += 1
        elif kind == "nothing":
            nothing_count += 1

    return (
        [c / 10.0 for c in res_counts]
        + [c / 10.0 for c in weapon_counts]
        + [c / 10.0 for c in equip_counts]
        + [nothing_count / 10.0]
        + [opp.get("carryCapacity", 0) / 8.0]
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def encode(state: dict, player_id: str | None = None) -> tuple[torch.Tensor, Masks]:
    """
    state:     raw GameState dict from the server
    player_id: the agent's player ID for this decision (used to orient loot encoding)

    Returns (obs, masks) where obs is shape [OBS_SIZE] and masks indicate valid actions.
    """
    players  = state.get("players", [])
    loc_map  = {l["id"]: l for l in state.get("locations", [])}
    phase    = state.get("phase", "action_selection")

    # Global
    phase_vec = [float(phase == p) for p in PHASES]
    round_vec = [state.get("round", 1) / 25.0]

    # Players (fixed order, padded)
    player_vecs = []
    for i in range(MAX_PLAYERS):
        if i < len(players):
            player_vecs.extend(_encode_player(players[i]))
        else:
            player_vecs.extend([0.0] * PLAYER_SIZE)

    # Locations (fixed order by LOCATION_IDS)
    loc_vecs = []
    for lid in LOCATION_IDS:
        loc_vecs.extend(_encode_location(loc_map.get(lid, {})))

    obs = torch.tensor(
        phase_vec + round_vec + player_vecs + loc_vecs
        + _encode_draft_pool(state)
        + _encode_loot(state, player_id),
        dtype=torch.float32,
    )

    # ── Masks ──────────────────────────────────────────────────────────────────

    survivor_mask = torch.zeros(MAX_PLAYERS, MAX_SURVIVORS, dtype=torch.bool)
    for i, p in enumerate(players[:MAX_PLAYERS]):
        if not p["isEliminated"]:
            for j, sv in enumerate(p.get("survivors", [])[:MAX_SURVIVORS]):
                survivor_mask[i, j] = bool(sv["alive"])

    location_mask = torch.tensor(
        [bool(loc_map.get(lid, {}).get("lootDeck")) for lid in LOCATION_IDS],
        dtype=torch.bool,
    )

    pool = state.get("draftPool", [])
    draft_pool_mask = torch.zeros(MAX_DRAFT_POOL, dtype=torch.bool)
    draft_pool_mask[:min(len(pool), MAX_DRAFT_POOL)] = True

    current_idx = next((i for i, p in enumerate(players) if p["id"] == player_id), None)
    opponent_mask = torch.tensor(
        [
            not p["isEliminated"] and i != current_idx
            for i, p in enumerate(players[:MAX_PLAYERS])
        ],
        dtype=torch.bool,
    )

    return obs, Masks(survivor_mask, location_mask, draft_pool_mask, opponent_mask)
