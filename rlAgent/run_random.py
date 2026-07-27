"""
Random agent — validates the server protocol end-to-end.
Makes legal but random decisions at every phase.
Run from the rlAgent/ directory: python run_random.py
"""

import random
from agent.client import GameClient

SERVER_CMD = "npx ts-node ../gameBackend/src/server/index.ts"


# ─────────────────────────────────────────────────────────────────────────────
# Decision helpers
# ─────────────────────────────────────────────────────────────────────────────

def decide_draft(state: dict, player_id: str) -> str:
    return random.choice(state["draftPool"])["id"]


def decide_actions(state: dict, player_id: str) -> list:
    player = next(p for p in state["players"] if p["id"] == player_id)
    survivors = [s for s in player["survivors"] if s["alive"]]
    open_locations = [l for l in state["locations"] if len(l["lootDeck"]) > 0]

    intents = []
    for sv in survivors:
        if open_locations:
            action = {"type": "scavenge", "locationId": random.choice(open_locations)["id"]}
        else:
            action = {"type": "rest"}
        intents.append({"survivorId": sv["id"], "action": action})

    return intents


def decide_loot(state: dict, player_id: str, loot_id: str) -> list:
    opp = next(o for o in state["lootOpportunities"] if o["id"] == loot_id)

    chosen = []
    item_slots_used = 0

    for i, token in enumerate(opp["revealedTokens"]):
        if token["kind"] == "resource":
            chosen.append(i)
        elif item_slots_used < opp["carryCapacity"]:
            chosen.append(i)
            item_slots_used += 1

    return chosen


def decide_upkeep(state: dict, player_id: str) -> dict:
    player = next(p for p in state["players"] if p["id"] == player_id)
    survivors = [s for s in player["survivors"] if s["alive"]]
    res = player["compound"]["resources"]

    food = res["food"]
    water = res["water"]
    sustenance = {}

    for sv in survivors:
        if food > 0:
            sustenance[sv["id"]] = "food"
            food -= 1
        elif water > 0:
            sustenance[sv["id"]] = "water"
            water -= 1
        else:
            sustenance[sv["id"]] = "none"

    return {"sustenance": sustenance, "medHeals": []}


# ─────────────────────────────────────────────────────────────────────────────
# Game loop
# ─────────────────────────────────────────────────────────────────────────────

def run_game(client: GameClient) -> str | None:
    winner_id = None

    while True:
        msg = client.recv()
        if msg is None:
            break

        t = msg["type"]
        game_id = msg["gameId"]
        player_id = msg.get("playerId")
        state = msg.get("state", {})

        if t == "game_start":
            print(f"  [{game_id}] Playing as {msg['playerName']} ({player_id})")

        elif t == "draft_request":
            client.send({
                "type": "draft_response",
                "gameId": game_id,
                "playerId": player_id,
                "survivorId": decide_draft(state, player_id),
            })

        elif t == "action_request":
            client.send({
                "type": "action_response",
                "gameId": game_id,
                "playerId": player_id,
                "intents": decide_actions(state, player_id),
            })

        elif t == "loot_request":
            client.send({
                "type": "loot_response",
                "gameId": game_id,
                "playerId": player_id,
                "lootId": msg["lootId"],
                "tokenIndices": decide_loot(state, player_id, msg["lootId"]),
            })

        elif t == "upkeep_request":
            client.send({
                "type": "upkeep_response",
                "gameId": game_id,
                "playerId": player_id,
                "allocations": decide_upkeep(state, player_id),
            })

        elif t == "game_over":
            winner_id = msg["winnerId"]
            rounds = state.get("round", "?")
            winner_name = next(
                (p["name"] for p in state.get("players", []) if p["id"] == winner_id),
                winner_id,
            )
            print(f"  [{game_id}] Game over after {rounds} rounds — winner: {winner_name}")
            break

    return winner_id


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Starting random agent...")
    client = GameClient(SERVER_CMD)
    try:
        run_game(client)
    finally:
        client.close()
