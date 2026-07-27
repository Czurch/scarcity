import { GameState, PlayerState } from '../../types';
import { damageSurvivor } from './conflictResolution';
import { addEvent } from '../helpers';
import { STRUCTURE_DEFS } from '../../data/items';

export function resolveUpkeep(state: GameState): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;

  const preUpkeepAlive: Record<string, number> = {};
  for (const p of s.players) {
    preUpkeepAlive[p.id] = p.survivors.filter((sv) => sv.alive).length;
  }

  for (const player of s.players) {
    if (player.isEliminated) continue;
    consumeSustenance(s, player);
    processRestHeal(player);
    processMedHeals(s, player);
  }

  for (const player of s.players) {
    if (player.isEliminated) continue;
    processStructureEffects(s, player);
  }

  // Clear round-scoped state
  for (const player of s.players) {
    for (const sv of player.survivors) sv.wellFed = false;
    player.intents = [];
    player.intentsSubmitted = false;
  }
  s.lootOpportunities = [];
  s.pendingConflicts = [];
  s.craftResults = [];
  s.reviewReadyPlayerIds = [];
  s.jammedPlayerIds = [];
  s.planningAllocations = {};
  s.upkeepAllocations = {};

  const surviving = s.players.filter((p) => !p.isEliminated);
  if (surviving.length <= 1) {
    s.phase = 'game_over';
    if (surviving.length === 1) {
      s.winnerId = surviving[0].id;
      addEvent(s, `GAME OVER — ${surviving[0].name} wins!`, ['game_over']);
    } else {
      const winner = s.players
        .filter((p) => p.isEliminated)
        .sort((a, b) => (preUpkeepAlive[b.id] ?? 0) - (preUpkeepAlive[a.id] ?? 0))[0];
      s.winnerId = winner?.id;
      addEvent(s, `GAME OVER — ${winner?.name ?? 'Nobody'} wins by last-survivor-count tiebreak!`, ['game_over']);
    }
  } else {
    s.round++;
    s.phase = 'planning';
    addEvent(s, `--- Round ${s.round} begins ---`, ['phase']);
  }

  return s;
}

function consumeSustenance(state: GameState, player: PlayerState): void {
  const alloc = state.planningAllocations[player.id];
  const sustenance = alloc?.sustenance ?? {};
  const aliveSurvivors = player.survivors.filter((sv) => sv.alive);

  let fedCount = 0, wateredCount = 0;
  const starvingNames: string[] = [];

  for (const sv of aliveSurvivors) {
    const choice = sustenance[sv.id] ?? 'none';

    if (choice === 'food' && player.compound.resources.food > 0) {
      player.compound.resources.food--;
      fedCount++;
    } else if (choice === 'water' && player.compound.resources.water > 0) {
      player.compound.resources.water--;
      wateredCount++;
    } else {
      if (!sv.debuffs.includes('starving')) sv.debuffs.push('starving');
      starvingNames.push(sv.name);
      damageSurvivor(state, sv.id, 1, 'starvation');
    }

    if (choice === 'food' || choice === 'water') {
      sv.debuffs = sv.debuffs.filter((d) => d !== 'starving');
    }
  }

  const parts: string[] = [];
  if (fedCount > 0) parts.push(`${fedCount} ate (well fed +1 THR)`);
  if (wateredCount > 0) parts.push(`${wateredCount} drank water`);
  if (starvingNames.length > 0) parts.push(`STARVING -1 HP: ${starvingNames.join(', ')}`);
  if (parts.length > 0) addEvent(state, `${player.name} upkeep: ${parts.join(' | ')}`, ['upkeep']);
}

function processRestHeal(player: PlayerState): void {
  for (const intent of player.intents) {
    if (intent.action.type !== 'rest') continue;
    const sv = player.survivors.find((sv) => sv.id === intent.survivorId);
    if (!sv || !sv.alive || !sv.wellFed || sv.hp >= sv.maxHp) continue;
    const before = sv.hp;
    sv.hp = Math.min(sv.hp + 1, sv.maxHp);
    if (sv.hp > before) {
      // logged via event in a parent scope — just mutate here
    }
  }
}

function processMedHeals(state: GameState, player: PlayerState): void {
  const medHeals = state.upkeepAllocations[player.id]?.medHeals ?? [];
  for (const survivorId of medHeals) {
    const sv = player.survivors.find((s) => s.id === survivorId);
    if (!sv || !sv.alive) continue;
    if (player.compound.resources.meds <= 0) break;
    player.compound.resources.meds--;
    const before = sv.hp;
    sv.hp = Math.min(sv.hp + 1, sv.maxHp);
    addEvent(state, `${sv.name} (${player.name}) treated with medkit: +${sv.hp - before} HP → ${sv.hp}/${sv.maxHp}.`, ['upkeep', 'heal']);
  }
}

function processStructureEffects(state: GameState, player: PlayerState): void {
  for (const built of player.compound.structures) {
    const def = STRUCTURE_DEFS[built.id];
    if (!def.generates) continue;
    const { resource, amount, everyNRounds } = def.generates;
    if (everyNRounds && state.round % everyNRounds !== 0) continue;
    player.compound.resources[resource] += amount;
    addEvent(state, `${def.name} generates ${amount}x ${resource} for ${player.name}.`, ['upkeep', 'structure']);
  }
}
