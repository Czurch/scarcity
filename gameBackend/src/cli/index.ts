import * as fs from 'fs';
import * as path from 'path';
import { GameConfig, DEFAULT_STARTING_RESOURCES, GameState } from '../types';
import { GameEngine } from '../GameEngine';
import {
  renderFullState, renderHeader, renderRecentLogs, renderDraftPool,
  printLine, printSuccess,
} from './display';
import { promptDraftPick, promptPlanning, promptIntents, promptLootClaim, promptUpkeepAllocation, closeInput } from './prompts';
import { runSimulation, printSimulationSummary, runStrategyTournament, printTournamentResults } from './simulation';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG — edit to change starting conditions
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: GameConfig = {
  playerCount: 4,
  playerNames: ['You', 'CPU Rusher', 'CPU Hoarder', 'CPU Raider'],
  humanPlayerIndices: [0],
  startingResources: { ...DEFAULT_STARTING_RESOURCES },
  locationLootConfigs: {},  // uses defaults from data/locations.ts
  picksPerPlayer: 4,
  winnerTakesDamage: false,
  seed: undefined,  // random each game
  aiStrategies: ['balanced', 'rusher', 'hoarder', 'raider'],
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTIVE GAME LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function playGame(config: GameConfig, autoDraft = false): Promise<void> {
  const engine = new GameEngine(config);

  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║      SCARCITY  —  Simulator      ║');
  console.log('  ╚══════════════════════════════════╝\n');

  // Auto-advance AI draft picks before prompting human
  engine.autoAdvance();

  while (!engine.isGameOver()) {
    const state = engine.getState();

    if (engine.isWaitingForHuman()) {
      const humanPlayer = state.players.find((p) => p.isHuman && !p.isEliminated)!;

      switch (state.phase) {
        case 'draft':
          if (autoDraft) {
            // Pick the first available survivor automatically
            engine.draftPick(humanPlayer.id, engine.getDraftPool()[0].id);
            engine.autoAdvance();
          } else {
            renderDraftPool(state as any);
            printLine(`\n  ${humanPlayer.name}, it's your pick (${(state.picksMade[humanPlayer.id] ?? 0) + 1}/${state.picksPerPlayer}):`);
            await promptDraftPick(engine, humanPlayer);
            engine.autoAdvance();
          }
          break;

        case 'action_selection':
          renderFullState(state as any);
          await promptIntents(engine, humanPlayer);
          engine.autoAdvance();
          break;

        case 'looting': {
          const opp = engine.getPendingLootForPlayer(humanPlayer.id);
          if (opp) {
            await promptLootClaim(engine, humanPlayer);
          }
          engine.autoAdvance();
          break;
        }

        case 'planning':
          renderFullState(engine.getState() as GameState);
          await promptPlanning(engine, humanPlayer);
          engine.autoAdvance();
          break;

        case 'upkeep':
          await promptUpkeepAllocation(engine, humanPlayer);
          engine.autoAdvance();
          break;
      }
    } else {
      engine.autoAdvance();
    }

    // Print events after each auto-advance
    const recent = engine.getLastRoundLogs().slice(-5);
    if (recent.length > 0 && !engine.isWaitingForHuman()) {
      for (const e of recent) {
        console.log(`  [R${e.round}] ${e.message}`);
      }
    }
  }

  // Game over
  const finalState = engine.getState() as GameState;
  renderFullState(finalState as any);
  const winner = engine.getWinner();
  console.log('\n' + '═'.repeat(60));
  console.log(`  GAME OVER — ${winner?.name ?? 'Nobody'} wins after ${finalState.round} rounds!`);
  console.log('═'.repeat(60) + '\n');

  saveGameLog(finalState, winner?.name ?? null);
  closeInput();
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME LOG
// ─────────────────────────────────────────────────────────────────────────────

function saveGameLog(state: GameState, winnerName: string | null): void {
  const logDir = path.join(process.cwd(), 'game-logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(logDir, `game-${timestamp}.json`);

  const log = {
    timestamp: new Date().toISOString(),
    seed: state.rngSeed,
    rounds: state.round,
    winner: winnerName,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHuman: p.isHuman,
      eliminated: p.isEliminated,
      survivorsAlive: p.survivors.filter((s) => s.alive).length,
      survivorsTotal: p.survivors.length,
      resources: { ...p.compound.resources },
      structures: p.compound.structures.map((s) => s.id),
    })),
    events: state.events,
  };

  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(`  Log saved → game-logs/game-${timestamp}.json`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION MODE
// ─────────────────────────────────────────────────────────────────────────────

function runSim(): void {
  const simConfig: GameConfig = {
    ...DEFAULT_CONFIG,
    playerCount: 4,
    playerNames: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    humanPlayerIndices: [],
    seed: 42,
  };

  const gameCount = parseInt(process.argv[3] ?? '100', 10);
  console.log(`\n  Running ${gameCount} simulated games...\n`);
  const summary = runSimulation(simConfig, gameCount, gameCount <= 20);
  printSimulationSummary(summary);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY TOURNAMENT MODE
// ─────────────────────────────────────────────────────────────────────────────

function runSimStrats(): void {
  const totalGames = parseInt(process.argv[3] ?? '400', 10);
  const roundedGames = Math.floor(totalGames / 4) * 4;  // must be divisible by 4
  console.log(`\n  Running strategy tournament (${roundedGames} games, 4 rotations)...\n`);
  const results = runStrategyTournament(
    {
      playerCount: 4,
      startingResources: { ...DEFAULT_STARTING_RESOURCES },
      locationLootConfigs: {},
      picksPerPlayer: 4,
      winnerTakesDamage: false,
      seed: 42,
    },
    roundedGames,
    roundedGames <= 40,
  );
  printTournamentResults(results, roundedGames);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const autoDraft = args.includes('--autodraft');

if (args.includes('--sim')) {
  runSim();
} else if (args.includes('--sim-strats')) {
  runSimStrats();
} else {
  playGame(DEFAULT_CONFIG, autoDraft).catch(console.error);
}
