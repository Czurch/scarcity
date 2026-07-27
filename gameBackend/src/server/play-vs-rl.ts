/**
 * Human vs RL agent entry point.
 * Starts a WebSocket server, waits for the Python RL agent to connect,
 * then runs a hybrid game loop: CLI prompts for the human, WebSocket for agent seats.
 *
 * Usage (from gameBackend/):
 *   npm run play
 *   npm run play -- --port=8080 --name=YourName --seed=42
 *
 * In a second terminal (from rlAgent/):
 *   python connect_as_agent.py --checkpoint checkpoints/model_update_0050.pt
 */

import { WebSocketServer, WebSocket } from 'ws';
import { GameEngine } from '../GameEngine';
import { GameConfig, DEFAULT_STARTING_RESOURCES, GameState, PlayerState } from '../types';
import { WebSocketTransport } from './transports/websocket';
import { Transport } from './transport';
import {
  renderFullState, printLine,
} from '../cli/display';
import {
  promptDraftPick, promptPlanning, promptIntents, promptLootClaim, promptUpkeepAllocation, closeInput,
} from '../cli/prompts';

// ─── Args ─────────────────────────────────────────────────────────────────────

const cliArgs = process.argv.slice(2);

const portArg  = cliArgs.find((a) => a.startsWith('--port='));
const PORT     = portArg ? parseInt(portArg.replace('--port=', ''), 10) : 8080;

const seedArg  = cliArgs.find((a) => a.startsWith('--seed='));
const seed     = seedArg ? parseInt(seedArg.replace('--seed=', ''), 10) : undefined;

const nameArg  = cliArgs.find((a) => a.startsWith('--name='));
const humanName = nameArg ? nameArg.replace('--name=', '') : 'You';

const gameId   = `game_${Date.now()}`;

// ─── Agent turn (one decision step via WebSocket) ─────────────────────────────

async function handleAgentTurn(engine: GameEngine, transport: Transport): Promise<void> {
  const state = engine.getState() as GameState;

  switch (state.phase) {
    case 'draft': {
      const drafter = engine.getCurrentDrafter();
      if (!drafter?.isAgent) return;
      await transport.send({ type: 'draft_request', gameId, playerId: drafter.id, state });
      const res = await transport.receive();
      if (res.type === 'draft_response') engine.draftPick(res.playerId, res.survivorId);
      break;
    }

    case 'planning': {
      const pending = state.players.find(
        (p) => p.isAgent && !p.isEliminated && !state.planningAllocations[p.id],
      );
      if (!pending) return;
      await transport.send({ type: 'planning_request', gameId, playerId: pending.id, state });
      const res = await transport.receive();
      if (res.type === 'planning_response') engine.submitPlanning(res.playerId, res.allocations);
      break;
    }

    case 'action_selection': {
      const pending = state.players.find((p) => p.isAgent && !p.isEliminated && !p.intentsSubmitted);
      if (!pending) return;
      await transport.send({ type: 'action_request', gameId, playerId: pending.id, state });
      const res = await transport.receive();
      if (res.type === 'action_response') engine.submitIntents(res.playerId, res.intents);
      break;
    }

    case 'looting': {
      const opp = state.lootOpportunities.find((o) => {
        if (o.claimed) return false;
        return state.players.find((p) => p.id === o.playerId)?.isAgent ?? false;
      });
      if (!opp) return;
      await transport.send({ type: 'loot_request', gameId, playerId: opp.playerId, lootId: opp.id, state });
      const res = await transport.receive();
      if (res.type === 'loot_response') engine.claimLoot(res.lootId, res.tokenIndices);
      break;
    }

    case 'upkeep': {
      const pending = state.players.find(
        (p) => p.isAgent && !p.isEliminated && !(state as any).upkeepAllocations?.[p.id],
      );
      if (!pending) return;
      await transport.send({ type: 'upkeep_request', gameId, playerId: pending.id, state });
      const res = await transport.receive();
      if (res.type === 'upkeep_response') engine.submitUpkeepAllocation(res.playerId, res.allocations);
      break;
    }
  }
}

// ─── Human turn (CLI prompts) ─────────────────────────────────────────────────

async function handleHumanTurn(engine: GameEngine, player: PlayerState): Promise<void> {
  const state = engine.getState() as GameState;

  switch (state.phase) {
    case 'draft':
      await promptDraftPick(engine, player);
      break;

    case 'planning':
      renderFullState(state);
      await promptPlanning(engine, player);
      break;

    case 'action_selection':
      renderFullState(state);
      await promptIntents(engine, player);
      break;

    case 'looting': {
      const opp = engine.getPendingLootForPlayer(player.id);
      if (opp) await promptLootClaim(engine, player);
      break;
    }

    case 'upkeep':
      await promptUpkeepAllocation(engine, player);
      break;
  }
}

// ─── Wait for WebSocket connection ────────────────────────────────────────────

function waitForConnection(port: number): Promise<WebSocket> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port });
    console.log(`\n  Waiting for RL agent on ws://localhost:${port} ...`);
    console.log(`  In another terminal, run (from rlAgent/):`);
    console.log(`    python connect_as_agent.py --checkpoint checkpoints/model_update_0050.pt\n`);
    wss.once('connection', (socket) => {
      console.log('  RL agent connected!\n');
      resolve(socket);
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const agentSocket = await waitForConnection(PORT);
  const transport   = new WebSocketTransport(agentSocket);

  const config: GameConfig = {
    playerCount: 4,
    playerNames:       [humanName, 'RL-1', 'RL-2', 'RL-3'],
    humanPlayerIndices: [0],
    agentPlayerIndices: [1, 2, 3],
    startingResources:  { ...DEFAULT_STARTING_RESOURCES },
    locationLootConfigs: {},
    picksPerPlayer:     4,
    winnerTakesDamage:  false,
    seed,
  };

  const engine = new GameEngine(config);

  // Notify the Python agent of all three seats
  for (const player of engine.getState().players.filter((p) => p.isAgent)) {
    await transport.send({
      type: 'game_start',
      gameId,
      playerId:   player.id,
      playerName: player.name,
      state:      engine.getState() as GameState,
    });
  }

  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║      SCARCITY  —  vs RL Agent    ║');
  console.log('  ╚══════════════════════════════════╝\n');

  engine.autoAdvance();

  while (!engine.isGameOver()) {
    const state       = engine.getState() as GameState;
    const humanPlayer = state.players.find((p) => p.isHuman && !p.isEliminated);

    if (engine.isWaitingForHuman() && humanPlayer) {
      await handleHumanTurn(engine, humanPlayer);
      engine.autoAdvance();
    } else if (engine.isWaitingForAgent()) {
      await handleAgentTurn(engine, transport);
      engine.autoAdvance();
    } else {
      // Safety: shouldn't reach here if autoAdvance is correct
      engine.autoAdvance();
    }
  }

  const finalState = engine.getState() as GameState;
  renderFullState(finalState);
  const winner = engine.getWinner();

  await transport.send({
    type:     'game_over',
    gameId,
    winnerId: winner?.id,
    state:    finalState,
  });

  console.log('\n' + '═'.repeat(60));
  console.log(`  GAME OVER — ${winner?.name ?? 'Nobody'} wins after ${finalState.round} rounds!`);
  console.log('═'.repeat(60) + '\n');

  await transport.close();
  closeInput();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
