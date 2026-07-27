import { GameConfig, DEFAULT_STARTING_RESOURCES } from '../types';
import { StdioTransport } from './transports/stdio';
import { runSession } from './session';

const args = process.argv.slice(2);

// --agent-players=0,1,2,3  (default: all four seats)
const agentArg = args.find((a) => a.startsWith('--agent-players='));
const agentPlayerIndices = agentArg
  ? agentArg.replace('--agent-players=', '').split(',').map(Number)
  : [0, 1, 2, 3];

// --seed=42
const seedArg = args.find((a) => a.startsWith('--seed='));
const seed = seedArg ? parseInt(seedArg.replace('--seed=', ''), 10) : undefined;

const gameId = `game_${Date.now()}`;

const playerNames = ['Agent-0', 'Agent-1', 'Agent-2', 'Agent-3'];

const config: GameConfig = {
  playerCount: 4,
  playerNames,
  humanPlayerIndices: [],
  agentPlayerIndices,
  startingResources: { ...DEFAULT_STARTING_RESOURCES },
  locationLootConfigs: {},
  picksPerPlayer: 4,
  winnerTakesDamage: false,
  seed,
};

const transport = new StdioTransport();
runSession(config, transport, gameId).catch((err) => {
  process.stderr.write(`Session error: ${err}\n`);
  process.exit(1);
});
