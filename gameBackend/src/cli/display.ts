import { GameState, PlayerState, SurvivorState, LootToken, LootOpportunity } from '../types';
import { getSurvivorThreat } from '../engine/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// ANSI COLORS
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
};

// Consistent color per player slot (up to 4 players)
const PLAYER_COLORS = [C.cyan, C.yellow, C.green, C.magenta];

const b = (s: string) => `${C.bold}${s}${C.reset}`;
const dim = (s: string) => `${C.dim}${s}${C.reset}`;
const red = (s: string) => `${C.red}${s}${C.reset}`;
const green = (s: string) => `${C.green}${s}${C.reset}`;
const yellow = (s: string) => `${C.yellow}${s}${C.reset}`;
const cyan = (s: string) => `${C.cyan}${s}${C.reset}`;
const gray = (s: string) => `${C.gray}${s}${C.reset}`;

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

export function tokenLabel(token: LootToken): string {
  if (token.kind === 'resource') return `${token.amount}x ${token.resource}`;
  if (token.kind === 'weapon')   return token.weaponId.replace(/_/g, ' ');
  if (token.kind === 'equipment') return token.equipmentId.replace(/_/g, ' ');
  return 'Picked Clean';
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH BAR
// ─────────────────────────────────────────────────────────────────────────────

function hpBar(hp: number, max: number): string {
  const filled = Math.max(0, hp);
  const bars = '█'.repeat(filled) + '░'.repeat(Math.max(0, max - filled));
  const colorCode = hp <= 1 ? C.red : hp <= max / 2 ? C.yellow : C.green;
  return `${colorCode}${bars}${C.reset} ${hp}/${max}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SURVIVOR ROW
// ─────────────────────────────────────────────────────────────────────────────

function survivorRow(sv: SurvivorState, ammoInCompound = 0): string {
  if (!sv.alive) return dim(`  ✗ ${sv.name} [DEAD]`);

  const threat = getSurvivorThreat(sv, ammoInCompound);
  const items = sv.equippedItems
    .map((i) => (i ? cyan(tokenLabel(i)) : gray('[ ]')))
    .join(' ');
  const debuffs = sv.debuffs.length > 0 ? ` ${red(sv.debuffs.map((d) => d.toUpperCase()).join(' '))}` : '';

  return `  ╟─ ${b(sv.name.padEnd(8))} HP:${hpBar(sv.hp, sv.maxHp)} THR:${yellow(String(threat).padStart(2))}  ${items}${debuffs}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER BLOCK
// ─────────────────────────────────────────────────────────────────────────────

function playerBlock(player: PlayerState, colorCode: string): string {
  const res = player.compound.resources;
  const tag = player.isHuman ? green('[YOU]') : player.isAgent ? yellow('[RL ]') : gray('[CPU]');
  const status = player.isEliminated ? red(' ELIMINATED') : '';
  const coloredName = `${colorCode}${C.bold}${player.name}${C.reset}`;
  const structures = player.compound.structures.map((s) => s.id.replace(/_/g, '-')).join(', ');

  const resourceLine = [
    `${cyan('WAT')}:${res.water}`,
    `${yellow('FOD')}:${res.food}`,
    `${green('MED')}:${res.meds}`,
    `${gray('WOD')}:${res.wood}`,
    `${gray('MET')}:${res.metal}`,
    `${gray('AMO')}:${res.ammo}`,
  ].join('  ');

  const lines = [
    `${coloredName} ${tag}${status}`,
    `  Resources: ${resourceLine}`,
    structures ? `  Structures: ${gray(structures)}` : '',
    ...player.survivors.map((sv) => survivorRow(sv, player.compound.resources.ammo)),
  ].filter(Boolean);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCATIONS BAR
// ─────────────────────────────────────────────────────────────────────────────

function locationBar(loc: GameState['locations'][0]): string {
  const filled = Math.min(loc.lootDeck.length, 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  const color = loc.lootDeck.length === 0 ? C.gray : loc.lootDeck.length < 5 ? C.red : C.green;
  return `  ${loc.name.padEnd(18)} ${color}${bar}${C.reset} ${String(loc.lootDeck.length).padStart(3)} cards`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RENDER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function renderHeader(state: GameState): void {
  const phase = state.phase.replace(/_/g, ' ').toUpperCase();
  console.log('\n' + '═'.repeat(60));
  console.log(b(`  SCARCITY  ·  Round ${state.round}  ·  ${phase}`));
  console.log('═'.repeat(60));
}

export function renderLocations(state: GameState): void {
  console.log(b('\n📍 LOCATIONS'));
  for (const loc of state.locations) {
    console.log(locationBar(loc));
  }
}

export function renderPlayers(state: GameState): void {
  console.log(b('\nCOLONIES'));
  for (let i = 0; i < state.players.length; i++) {
    const color = PLAYER_COLORS[i] ?? C.white;
    console.log('');
    console.log(playerBlock(state.players[i], color));
  }
}

export function renderLootOpportunity(opp: LootOpportunity): void {
  const locationLabel = opp.target.kind === 'location'
    ? opp.target.locationId.replace(/_/g, ' ')
    : `${(opp.target as any).defenderId}'s compound`;
  console.log(b(`\nLOOT @ ${locationLabel.toUpperCase()}`));
  console.log(`  Resources: take ALL  |  Weapons/Equipment: up to ${yellow(String(opp.carryCapacity))} item slot(s)`);
  opp.revealedTokens.forEach((token, i) => {
    if (token.kind === 'nothing') {
      console.log(`  [${i}] ${gray('Picked Clean')} ${gray('[discarded]')}`);
    } else {
      const kind = token.kind === 'resource' ? gray('[resource]') : yellow('[item]');
      console.log(`  [${i}] ${cyan(tokenLabel(token))} ${kind}`);
    }
  });
}

/** Replace every occurrence of each player's name with their team color. */
function colorizeMessage(msg: string, players: PlayerState[]): string {
  let result = msg;
  for (let i = 0; i < players.length; i++) {
    const color = PLAYER_COLORS[i] ?? C.white;
    result = result.replaceAll(players[i].name, `${color}${players[i].name}${C.reset}`);
  }
  return result;
}

const PHASE_LABEL: Record<string, string> = {
  draft:               'DRFT',
  planning:            'PLAN',
  action_selection:    'ACT ',
  conflict_resolution: 'CFLT',
  looting:             'LOOT',
  upkeep:              'UPK ',
  game_over:           'END ',
};

export function renderRecentLogs(state: GameState): void {
  const lastRound = state.round - 1;
  const events = lastRound >= 1
    ? state.events.filter((e) => e.round === lastRound)
    : state.events.filter((e) => e.round === state.round);

  if (events.length === 0) return;
  console.log(b(`\nROUND ${lastRound >= 1 ? lastRound : state.round} RECAP`));
  for (const e of events) {
    const label = PHASE_LABEL[e.phase] ?? '    ';
    console.log(`  ${gray(label)} ${colorizeMessage(e.message, state.players)}`);
  }
}

export function renderDraftPool(state: GameState): void {
  console.log(b('\n🎲 DRAFT POOL'));
  state.draftPool.forEach((sv, i) => {
    const passive = sv.passive ? gray(` — ${sv.passive}`) : '';
    console.log(`  [${i}] ${b(sv.id.padEnd(10))} HP:${sv.maxHp} THR:${sv.baseThreat}${passive}`);
  });
}

export function renderFullState(state: GameState): void {
  renderHeader(state);
  renderLocations(state);
  renderPlayers(state);
  renderRecentLogs(state);
}

export function printLine(msg: string): void {
  console.log(msg);
}

export function printError(msg: string): void {
  console.log(red(`  ✗ ${msg}`));
}

export function printSuccess(msg: string): void {
  console.log(green(`  ✓ ${msg}`));
}
