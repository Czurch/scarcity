import {
  GameState, PlayerState, SurvivorState, LocationId, LootOpportunity, ConflictTarget, ConflictSquad,
} from '../../types';
import { createRng } from '../../utils/rng';
import { getSurvivorThreat, getCompoundThreat, getMaxSlots, getFlashlightBonus, addEvent } from '../helpers';
import { resolveCrafting } from './crafting';

/**
 * Resolve all conflicts from declared intents.
 * Mutates a deep-cloned state in place.
 * Returns state with phase set to 'looting' and lootOpportunities populated.
 */
export function resolveAllConflicts(state: GameState): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const rng = createRng(s.rngSeed + s.rngCounter++);

  logActionSummary(s);
  resolveCrafting(s);
  resolveJammers(s);
  resolveLocationConflicts(s, rng);
  resolveCompoundAttacks(s, rng);

  s.phase = 'looting';
  addEvent(s, 'Conflict resolution complete. Looting begins...', ['phase']);
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// JAMMERS
// ─────────────────────────────────────────────────────────────────────────────

function resolveJammers(state: GameState): void {
  state.jammedPlayerIds = [];
  for (const player of state.players) {
    if (player.isEliminated) continue;
    for (const intent of player.intents) {
      if (intent.action.type !== 'jam') continue;
      const sv = player.survivors.find((s) => s.id === intent.survivorId);
      if (!sv || !sv.alive) continue;
      const jammerIdx = sv.equippedItems.findIndex(
        (item) => item?.kind === 'equipment' && item.equipmentId === 'jammer',
      );
      if (jammerIdx === -1) continue;
      sv.equippedItems[jammerIdx] = null;
      const targetId = intent.action.targetPlayerId;
      if (!state.jammedPlayerIds.includes(targetId)) {
        state.jammedPlayerIds.push(targetId);
        const target = state.players.find((p) => p.id === targetId);
        addEvent(state, `${sv.name} (${player.name}) jams ${target?.name ?? targetId}'s electronics!`, ['jam']);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCATION CONFLICTS
// ─────────────────────────────────────────────────────────────────────────────

function resolveLocationConflicts(state: GameState, rng: ReturnType<typeof createRng>): void {
  // Group scavenging survivors by location → by player
  const byLocation = new Map<LocationId, Map<string, string[]>>();

  for (const player of state.players) {
    if (player.isEliminated) continue;
    for (const intent of player.intents) {
      if (intent.action.type !== 'scavenge') continue;
      const locId = intent.action.locationId;
      if (!byLocation.has(locId)) byLocation.set(locId, new Map());
      const byPlayer = byLocation.get(locId)!;
      if (!byPlayer.has(player.id)) byPlayer.set(player.id, []);
      byPlayer.get(player.id)!.push(intent.survivorId);
    }
  }

  for (const [locId, byPlayer] of byLocation.entries()) {
    const loc = state.locations.find((l) => l.id === locId)!;
    const target: ConflictTarget = { kind: 'location', locationId: locId };

    const squads: ConflictSquad[] = [...byPlayer.entries()].map(([playerId, survivorIds]) => ({
      playerId,
      survivorIds,
      totalThreat: survivorIds.reduce((sum, sid) => {
        const sv = findSurvivor(state, sid)!;
        return sum + getSurvivorThreat(sv);
      }, 0),
    }));

    if (loc.lootDeck.length === 0) {
      addEvent(state, `${loc.name} is depleted — no loot available.`, ['loot']);
      state.pendingConflicts.push({ id: `conflict_${_conflictCounter++}`, target, squads, tieBreaks: 0, lootOpportunityIds: [] });
      continue;
    }

    if (byPlayer.size === 1) {
      // Uncontested
      const [[playerId, survivorIds]] = [...byPlayer.entries()];
      const lootId = addLootOpportunity(state, playerId, survivorIds, target);
      state.pendingConflicts.push({
        id: `conflict_${_conflictCounter++}`,
        target,
        squads,
        winnerId: playerId,
        tieBreaks: 0,
        lootOpportunityIds: [lootId],
      });
    } else {
      // Conflict: squad threats already computed above
      logConflict(state, squads, `location ${loc.name}`);
      const { winnerId, tieBreaks } = pickWinnerId(squads, rng, state);

      // Losers take 1 HP damage per survivor
      for (const sq of squads.filter((s) => s.playerId !== winnerId)) {
        const loser = state.players.find((p) => p.id === sq.playerId)!;
        for (const sid of sq.survivorIds) {
          const sv = findSurvivor(state, sid);
          addEvent(state, `${sv?.name ?? sid} (${loser.name}) loses the fight and takes 1 damage`, ['conflict', 'damage']);
          damageSurvivor(state, sid, 1, `conflict at ${loc.name}`);
        }
      }

      // Winner gets loot
      const winnerSurvivors = byPlayer.get(winnerId)!;
      const lootId = addLootOpportunity(state, winnerId, winnerSurvivors, target);
      state.pendingConflicts.push({
        id: `conflict_${_conflictCounter++}`,
        target,
        squads,
        winnerId,
        tieBreaks,
        lootOpportunityIds: [lootId],
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOUND ATTACKS
// ─────────────────────────────────────────────────────────────────────────────

function resolveCompoundAttacks(state: GameState, rng: ReturnType<typeof createRng>): void {
  // Group attackers by target player
  const byTarget = new Map<string, Map<string, string[]>>();

  for (const player of state.players) {
    if (player.isEliminated) continue;
    for (const intent of player.intents) {
      if (intent.action.type !== 'attack') continue;
      const targetId = intent.action.targetPlayerId;
      if (!byTarget.has(targetId)) byTarget.set(targetId, new Map());
      const byPlayer = byTarget.get(targetId)!;
      if (!byPlayer.has(player.id)) byPlayer.set(player.id, []);
      byPlayer.get(player.id)!.push(intent.survivorId);
    }
  }

  for (const [targetId, attackersByPlayer] of byTarget.entries()) {
    const targetPlayer = state.players.find((p) => p.id === targetId);
    if (!targetPlayer || targetPlayer.isEliminated) continue;

    const defenderThreat = getCompoundThreat(targetPlayer, true, state.jammedPlayerIds);
    const defenderSurvivorIds = targetPlayer.survivors
      .filter((sv) => {
        if (!sv.alive) return false;
        const intent = targetPlayer.intents.find((i) => i.survivorId === sv.id);
        return intent?.action.type === 'defend';
      })
      .map((sv) => sv.id);

    // Resolve each attacker group vs the compound separately
    for (const [attackerId, attackerSurvivorIds] of attackersByPlayer.entries()) {
      const attacker = state.players.find((p) => p.id === attackerId)!;
      const attackThreat = attackerSurvivorIds.reduce((sum, sid) => {
        const sv = findSurvivor(state, sid)!;
        return sum + getSurvivorThreat(sv);
      }, 0);

      const squads: ConflictSquad[] = [
        { playerId: attackerId, survivorIds: attackerSurvivorIds, totalThreat: attackThreat },
        { playerId: targetId, survivorIds: defenderSurvivorIds, totalThreat: defenderThreat },
      ];
      const target: ConflictTarget = { kind: 'compound', defenderId: targetId };

      logConflict(state, squads, `${targetPlayer.name}'s compound`);
      const { winnerId, tieBreaks } = pickWinnerId(squads, rng, state);
      const lootOpportunityIds: string[] = [];

      if (winnerId === attackerId) {
        // Attacker wins: gains a loot opportunity vs the compound (choose: loot OR damage)
        addEvent(state, `${attacker.name} successfully raids ${targetPlayer.name}'s compound!`, ['conflict', 'raid']);
        lootOpportunityIds.push(addLootOpportunity(state, attackerId, attackerSurvivorIds, target));
      } else {
        // Defender wins: damage attackers
        for (const sid of attackerSurvivorIds) {
          damageSurvivor(state, sid, 1, `repelled at ${targetPlayer.name}'s compound`);
        }
        addEvent(state, `${targetPlayer.name} repels ${attacker.name}'s attack.`, ['conflict']);
      }

      state.pendingConflicts.push({
        id: `conflict_${_conflictCounter++}`,
        target,
        squads,
        winnerId,
        tieBreaks,
        lootOpportunityIds,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

let _lootCounter = 0;
let _conflictCounter = 0;

function addLootOpportunity(
  state: GameState,
  playerId: string,
  survivorIds: string[],
  target: LootOpportunity['target'],
): string {
  if (target.kind === 'location') {
    const loc = state.locations.find((l) => l.id === target.locationId)!;
    const flashlightBonus = survivorIds.reduce((sum, sid) => {
      const sv = findSurvivor(state, sid);
      return sv ? sum + getFlashlightBonus(sv) : sum;
    }, 0);
    const reveal = Math.min(survivorIds.length + 2 + flashlightBonus, loc.lootDeck.length);
    const revealedTokens = loc.lootDeck.slice(0, reveal);
    // Unchosen tokens go back to bottom of deck after claiming
    loc.lootDeck = loc.lootDeck.slice(reveal);

    const freeSlots = survivorIds.reduce((sum, sid) => {
      const sv = findSurvivor(state, sid);
      if (!sv) return sum;
      return sum + Math.max(0, getMaxSlots(sv) - sv.equippedItems.filter(Boolean).length);
    }, 0);

    const id = `loot_${_lootCounter++}`;
    state.lootOpportunities.push({
      id,
      playerId,
      survivorIds,
      target,
      revealedTokens,
      carryCapacity: freeSlots,
      claimed: false,
    });
    return id;
  } else {
    // Compound raid — reveal top resources from defender's compound
    const defender = state.players.find((p) => p.id === target.defenderId)!;
    const resources = Object.entries(defender.compound.resources)
      .filter(([, v]) => v > 0)
      .flatMap(([res, count]) =>
        Array.from({ length: count as number }, () => ({
          kind: 'resource' as const,
          resource: res as any,
          amount: 1,
        })),
      );

    const raidSlots = survivorIds.reduce((sum, sid) => {
      const sv = findSurvivor(state, sid);
      if (!sv) return sum;
      return sum + Math.max(0, getMaxSlots(sv) - sv.equippedItems.filter(Boolean).length);
    }, 0);

    const id = `loot_${_lootCounter++}`;
    state.lootOpportunities.push({
      id,
      playerId,
      survivorIds,
      target,
      revealedTokens: resources,  // all compound resources are visible (public info)
      carryCapacity: raidSlots,
      claimed: false,
    });
    return id;
  }
}

function pickWinnerId(
  squads: { playerId: string; survivorIds: string[]; totalThreat: number }[],
  rng: ReturnType<typeof createRng>,
  state: GameState,
): { winnerId: string; tieBreaks: number } {
  let sorted = [...squads].sort((a, b) => b.totalThreat - a.totalThreat);
  let tieBreaks = 0;

  while (sorted.length > 1 && sorted[0].totalThreat === sorted[1].totalThreat) {
    // Tie — each rolls a d6
    for (const sq of sorted) {
      sq.totalThreat += rng.d6();
    }
    sorted.sort((a, b) => b.totalThreat - a.totalThreat);
    tieBreaks++;
    addEvent(state, `Tie broken by dice roll!`, ['conflict', 'tiebreak']);
  }

  return { winnerId: sorted[0].playerId, tieBreaks };
}

export function damageSurvivor(state: GameState, survivorId: string, amount: number, reason: string): void {
  for (const player of state.players) {
    const sv = player.survivors.find((s) => s.id === survivorId);
    if (!sv || !sv.alive) continue;

    // Armor check
    const armorIdx = sv.equippedItems.findIndex(
      (item) => item?.kind === 'equipment' && item.equipmentId === 'armor',
    );
    if (armorIdx !== -1) {
      sv.equippedItems[armorIdx] = null;
      addEvent(state, `${sv.name}'s armor absorbs the hit!`, ['armor']);
      return;
    }

    sv.hp = Math.max(0, sv.hp - amount);
    addEvent(state, `${sv.name} (${player.name}) -${amount} HP from ${reason} [${sv.hp}/${sv.maxHp}]`, ['damage']);

    if (sv.hp <= 0) {
      sv.alive = false;
      addEvent(state, `☠ ${sv.name} has died.`, ['death']);
      checkElimination(state, player);
    }
    return;
  }
}

function checkElimination(state: GameState, player: PlayerState): void {
  if (player.survivors.every((s) => !s.alive)) {
    player.isEliminated = true;
    addEvent(state, `${player.name} has been eliminated!`, ['elimination']);
  }
}

function logActionSummary(state: GameState): void {
  for (const player of state.players) {
    if (player.isEliminated) continue;
    for (const intent of player.intents) {
      const sv = findSurvivor(state, intent.survivorId);
      if (!sv || !sv.alive) continue;
      const action = intent.action;
      let desc: string;
      if (action.type === 'scavenge') {
        const loc = state.locations.find((l) => l.id === action.locationId);
        desc = `scavenges ${loc?.name ?? action.locationId}`;
      } else if (action.type === 'attack') {
        const target = state.players.find((p) => p.id === action.targetPlayerId);
        desc = `attacks ${target?.name ?? action.targetPlayerId}'s compound`;
      } else if (action.type === 'defend') {
        desc = 'defends compound';
      } else if (action.type === 'rest') {
        desc = 'rests';
      } else if (action.type === 'jam') {
        const target = state.players.find((p) => p.id === action.targetPlayerId);
        desc = `jams ${target?.name ?? action.targetPlayerId}'s electronics`;
      } else {
        desc = action.type;
      }
      addEvent(state, `${sv.name} (${player.name}) ${desc}`, ['action']);
    }
  }
}

function logConflict(
  state: GameState,
  squads: { playerId: string; survivorIds: string[]; totalThreat: number }[],
  location: string,
): void {
  const label = squads
    .map((sq) => {
      const p = state.players.find((p) => p.id === sq.playerId)!;
      const names = sq.survivorIds
        .map((sid) => findSurvivor(state, sid)?.name ?? sid)
        .join(', ');
      return `${p.name} [${names}] THR:${sq.totalThreat}`;
    })
    .join(' vs ');
  addEvent(state, `CONFLICT @ ${location}: ${label}`, ['conflict']);
}

function findSurvivor(state: GameState, survivorId: string): SurvivorState | undefined {
  for (const player of state.players) {
    const sv = player.survivors.find((s) => s.id === survivorId);
    if (sv) return sv;
  }
  return undefined;
}
