import { GameConfig, SimulationResult, SimulationSummary, GameState, AIStrategy } from '../types';
import { GameEngine } from '../GameEngine';

/**
 * Run N fully-automated games and return aggregate statistics.
 * All players are CPU-controlled for pure balance analysis.
 */
export function runSimulation(
  baseConfig: Omit<GameConfig, 'humanPlayerIndices'>,
  gameCount: number,
  verbose = false,
): SimulationSummary {
  const results: SimulationResult[] = [];
  const config: GameConfig = { ...baseConfig, humanPlayerIndices: [] };

  for (let i = 0; i < gameCount; i++) {
    const seed = (baseConfig.seed ?? 0) + i;
    const engine = new GameEngine({ ...config, seed });
    engine.runToEnd();

    const state = engine.getState();
    const winner = engine.getWinner();
    const eliminated = state.players
      .filter((p) => p.isEliminated)
      .map((p) => {
        const deathEvent = [...state.events].reverse().find((e: GameState['events'][0]) => e.message.includes(p.name) && e.tags.includes('elimination'));
        return { playerId: p.id, playerName: p.name, round: deathEvent?.round ?? state.round };
      });

    const result: SimulationResult = {
      gameId: i,
      winnerId: winner?.id ?? 'none',
      winnerName: winner?.name ?? 'Draw',
      rounds: state.round,
      eliminated,
    };
    results.push(result);

    if (verbose) {
      console.log(`  Game ${i + 1}: ${result.winnerName} wins in ${result.rounds} rounds`);
    }
  }

  return summarize(results, config.playerNames);
}

function summarize(results: SimulationResult[], playerNames: string[]): SimulationSummary {
  const winCounts: Record<string, number> = {};
  for (const name of playerNames) winCounts[name] = 0;

  let totalRounds = 0;
  const roundsList: number[] = [];

  for (const r of results) {
    winCounts[r.winnerName] = (winCounts[r.winnerName] ?? 0) + 1;
    totalRounds += r.rounds;
    roundsList.push(r.rounds);
  }

  const n = results.length;
  const winRates: Record<string, string> = {};
  for (const [name, count] of Object.entries(winCounts)) {
    winRates[name] = `${((count / n) * 100).toFixed(1)}%`;
  }

  return {
    gamesPlayed: n,
    winCounts,
    winRates,
    avgRounds: Math.round(totalRounds / n),
    minRounds: Math.min(...roundsList),
    maxRounds: Math.max(...roundsList),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY TOURNAMENT
// ─────────────────────────────────────────────────────────────────────────────

const STRATEGIES: AIStrategy[] = ['balanced', 'rusher', 'hoarder', 'raider'];

export interface TournamentResult {
  strategy: AIStrategy;
  wins: number;
  games: number;
  winRate: string;
}

/**
 * Run 4 rotations of N/4 games each. In each rotation, strategies are assigned
 * to different seat positions so no strategy benefits from a fixed seat index.
 *
 * Rotation 0: [balanced, rusher, hoarder, raider]
 * Rotation 1: [rusher, hoarder, raider, balanced]
 * Rotation 2: [hoarder, raider, balanced, rusher]
 * Rotation 3: [raider, balanced, rusher, hoarder]
 */
export function runStrategyTournament(
  baseConfig: Omit<GameConfig, 'humanPlayerIndices' | 'playerNames' | 'aiStrategies'>,
  totalGames: number,
  verbose = false,
): TournamentResult[] {
  const gamesPerRotation = Math.floor(totalGames / 4);
  const winsByStrategy: Record<AIStrategy, number> = { balanced: 0, rusher: 0, hoarder: 0, raider: 0 };

  for (let rot = 0; rot < 4; rot++) {
    // Rotate strategy assignment so each sits in each seat
    const rotatedStrategies = STRATEGIES.map((_, i) => STRATEGIES[(i + rot) % 4]);
    const names = rotatedStrategies.map((s) => s[0].toUpperCase() + s.slice(1));

    const config: GameConfig = {
      ...baseConfig,
      playerCount: 4,
      playerNames: names,
      humanPlayerIndices: [],
      aiStrategies: rotatedStrategies,
    };

    const seedOffset = rot * gamesPerRotation;
    for (let i = 0; i < gamesPerRotation; i++) {
      const seed = (baseConfig.seed ?? 0) + seedOffset + i;
      const engine = new GameEngine({ ...config, seed });
      engine.runToEnd();
      const winner = engine.getWinner();
      if (winner) {
        const seatIndex = parseInt(winner.id.split('_')[1], 10);
        const strategy = rotatedStrategies[seatIndex];
        winsByStrategy[strategy]++;
      }
      if (verbose) {
        console.log(`  [rot${rot}] Game ${i + 1}: ${winner?.name ?? 'Draw'}`);
      }
    }
  }

  const totalPlayed = gamesPerRotation * 4;
  return STRATEGIES.map((s) => ({
    strategy: s,
    wins: winsByStrategy[s],
    games: totalPlayed,
    winRate: `${((winsByStrategy[s] / totalPlayed) * 100).toFixed(1)}%`,
  }));
}

export function printTournamentResults(results: TournamentResult[], totalGames: number): void {
  console.log('\n' + '═'.repeat(55));
  console.log(`  STRATEGY TOURNAMENT  (${totalGames} games, 4 rotations)`);
  console.log('  Expected baseline: 25.0% per strategy');
  console.log('═'.repeat(55));
  for (const r of results) {
    const pct = parseFloat(r.winRate);
    const bar = '█'.repeat(Math.round(pct / 2));
    const delta = pct - 25;
    const sign = delta >= 0 ? '+' : '';
    console.log(
      `    ${r.strategy.padEnd(10)} ${bar.padEnd(14)} ${r.winRate.padStart(5)}  (${sign}${delta.toFixed(1)}pp)  ${r.wins}/${r.games}`,
    );
  }
  console.log('═'.repeat(55));
}

export function printSimulationSummary(summary: SimulationSummary): void {
  console.log('\n' + '═'.repeat(50));
  console.log(`  SIMULATION RESULTS  (${summary.gamesPlayed} games)`);
  console.log('═'.repeat(50));
  console.log(`  Avg rounds: ${summary.avgRounds}  (min: ${summary.minRounds}, max: ${summary.maxRounds})`);
  console.log('\n  Win rates:');
  for (const [name, rate] of Object.entries(summary.winRates)) {
    const count = summary.winCounts[name];
    const bar = '█'.repeat(Math.round(parseFloat(rate) / 2));
    console.log(`    ${name.padEnd(12)} ${bar.padEnd(50)} ${rate} (${count}/${summary.gamesPlayed})`);
  }
  console.log('═'.repeat(50));
}
