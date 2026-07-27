"""
RL agent WebSocket client — connects to the TS game server and plays using a trained model.

Usage (from rlAgent/):
    python connect_as_agent.py --checkpoint checkpoints/model_update_0050.pt
    python connect_as_agent.py                    # random weights (for testing)
    python connect_as_agent.py --port 9090        # custom port

Run AFTER starting: npm run play  (from gameBackend/)
"""

import asyncio
import json
import argparse
import sys
import torch
import websockets

from agent.encoder import encode, LOCATION_IDS, MAX_SURVIVORS
from agent.model import ActorCritic, ACT_SCAV_START, ACT_SCAV_END, ACT_ATTACK_START
from agent.decoder import decode_loot
from training.ppo import _survivor_action_mask

NEG_INF = float('-inf')


def _sample(logits: torch.Tensor, mask: torch.Tensor) -> int:
    masked = logits.clone()
    masked[~mask] = NEG_INF
    probs = torch.softmax(masked, dim=-1)
    return int(torch.multinomial(probs, 1).item())


def handle_message(msg: dict, model: ActorCritic) -> dict | None:
    t         = msg['type']
    game_id   = msg.get('gameId', '')
    player_id = msg.get('playerId', '')
    state     = msg.get('state', {})

    if t == 'game_start':
        print(f"  Registered as {msg['playerName']} ({player_id})", flush=True)
        return None

    if t == 'game_over':
        players   = state.get('players', [])
        winner_id = msg.get('winnerId')
        winner    = next((p for p in players if p['id'] == winner_id), None)
        print(f"  Game over! Winner: {winner['name'] if winner else 'Nobody'}", flush=True)
        return None

    # ── Planning ───────────────────────────────────────────────────────────────
    if t == 'planning_request':
        player        = next(p for p in state['players'] if p['id'] == player_id)
        survivors     = player['survivors']
        res           = player['compound']['resources']
        food, water   = res['food'], res['water']
        sustenance    = {}

        for sv in survivors:
            if not sv['alive']:
                continue
            if food > 0:
                sustenance[sv['id']] = 'food'
                food -= 1
            elif water > 0:
                sustenance[sv['id']] = 'water'
                water -= 1
            else:
                sustenance[sv['id']] = 'none'

        return {
            'type':        'planning_response',
            'gameId':      game_id,
            'playerId':    player_id,
            'allocations': {'sustenance': sustenance},
        }

    obs, masks = encode(state, player_id)

    with torch.no_grad():
        out = model(obs.unsqueeze(0))

    # ── Draft ──────────────────────────────────────────────────────────────────
    if t == 'draft_request':
        pool = sorted(state['draftPool'], key=lambda s: s['id'])
        idx  = _sample(out['draft'].squeeze(0), masks.draft_pool)
        return {
            'type':       'draft_response',
            'gameId':     game_id,
            'playerId':   player_id,
            'survivorId': pool[idx]['id'],
        }

    # ── Action selection ───────────────────────────────────────────────────────
    if t == 'action_request':
        player        = next(p for p in state['players'] if p['id'] == player_id)
        survivors     = player['survivors']
        sv_mask       = _survivor_action_mask(masks.locations, masks.opponents)
        action_logits = out['action'].squeeze(0)
        intents       = []

        for sv_slot, sv in enumerate(survivors[:MAX_SURVIVORS]):
            if not sv['alive']:
                continue
            act_idx = _sample(action_logits[sv_slot], sv_mask)

            if act_idx == 0:
                action = {'type': 'rest'}
            elif act_idx == 1:
                action = {'type': 'defend'}
            elif ACT_SCAV_START <= act_idx < ACT_SCAV_END:
                action = {'type': 'scavenge', 'locationId': LOCATION_IDS[act_idx - ACT_SCAV_START]}
            else:
                target = state['players'][act_idx - ACT_ATTACK_START]
                action = {'type': 'attack', 'targetPlayerId': target['id']}

            intents.append({'survivorId': sv['id'], 'action': action})

        return {
            'type':     'action_response',
            'gameId':   game_id,
            'playerId': player_id,
            'intents':  intents,
        }

    # ── Loot ───────────────────────────────────────────────────────────────────
    if t == 'loot_request':
        return decode_loot(
            out['loot'].squeeze(0), masks, state, player_id, game_id, msg['lootId']
        )

    # ── Upkeep ─────────────────────────────────────────────────────────────────
    if t == 'upkeep_request':
        return {
            'type':        'upkeep_response',
            'gameId':      game_id,
            'playerId':    player_id,
            'allocations': {'medHeals': []},
        }

    return None


async def run(checkpoint: str | None, port: int) -> None:
    model = ActorCritic()
    if checkpoint:
        ckpt = torch.load(checkpoint, weights_only=True)
        model.load_state_dict(ckpt['model'])
        print(f'Loaded checkpoint: {checkpoint}', flush=True)
    else:
        print('No checkpoint — using random weights.', flush=True)
    model.eval()

    uri = f'ws://localhost:{port}'
    print(f'Connecting to {uri} ...', flush=True)

    async with websockets.connect(uri) as ws:
        print('Connected. Waiting for game to start...\n', flush=True)
        async for raw in ws:
            msg = json.loads(raw)
            if msg['type'] == 'game_over':
                handle_message(msg, model)
                break
            response = handle_message(msg, model)
            if response is not None:
                await ws.send(json.dumps(response))

    print('Disconnected.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=str, default=None, help='Path to .pt checkpoint file')
    parser.add_argument('--port',       type=int, default=8080,  help='WebSocket port (default 8080)')
    args = parser.parse_args()
    asyncio.run(run(args.checkpoint, args.port))
