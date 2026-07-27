import {
  GameState, PlayerState, SurvivorState, SurvivorIntent, SurvivorAction,
  LocationId, ResourceType, LocationState,
} from '../types';
import { getActiveSurvivors, getMaxSlots } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Resources each location can yield — used to match needs against deck
// ─────────────────────────────────────────────────────────────────────────────

const LOCATION_RESOURCES: Record<LocationId, ResourceType[]> = {
  reservoir:      ['water'],
  grocery:        ['food', 'water'],
  mini_mart:      ['water', 'food', 'meds'],
  hospital:       ['meds', 'food', 'water'],
  woods:          ['wood', 'food', 'water'],
  commercial:     ['metal', 'wood', 'food', 'water'],
  mall:           ['water', 'food', 'meds', 'wood', 'metal'],
  residential:    ['water', 'food', 'meds', 'wood', 'metal'],
  police_station: ['metal', 'ammo'],
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export function generateAIIntents(state: GameState, player: PlayerState): SurvivorIntent[] {
  switch (player.aiStrategy) {
    case 'rusher':  return rusherIntents(state, player);
    case 'hoarder': return hoarderIntents(state, player);
    case 'raider':  return raiderIntents(state, player);
    default:        return balancedIntents(state, player);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGIES
// ─────────────────────────────────────────────────────────────────────────────

function balancedIntents(state: GameState, player: PlayerState): SurvivorIntent[] {
  const survivors = getActiveSurvivors(player);
  if (survivors.length === 0) return [];

  const needs = assessNeeds(player);
  const scoredLocs = scoreLocations(state, player, needs, 1.5);
  const best = scoredLocs.find((l) => l.score > 0);
  const fallback = (sv: SurvivorState): SurvivorAction =>
    sv.wellFed && sv.hp < sv.maxHp ? { type: 'rest' } : best ? { type: 'scavenge', locationId: best.id } : { type: 'defend' };

  // Weapon carriers have fewer free slots and make better defenders than looters.
  // Sort by free slots ascending so armed survivors defend, unarmed survivors scavenge.
  const freeSlots = (sv: SurvivorState) => getMaxSlots(sv) - sv.equippedItems.filter(Boolean).length;
  const byLootValue = [...survivors].sort((a, b) => freeSlots(a) - freeSlots(b));
  const nDefend = defenderCount(survivors.length, player.id, state.round, state.rngSeed);

  return byLootValue.map((sv, i) => ({
    survivorId: sv.id,
    action: i < nDefend ? { type: 'defend' as const } : fallback(sv),
  }));
}

/** Intermittently assign 1-2 defenders based on squad size and a round hash. */
function defenderCount(survivorCount: number, playerId: string, round: number, seed: number): number {
  if (survivorCount <= 2) return 0;
  let h = (seed ^ round ^ 0xdeadbeef) * 2654435761;
  for (const c of playerId) h = Math.imul(h ^ c.charCodeAt(0), 2246822519);
  const roll = Math.abs(h) % 10;
  if (survivorCount === 3) return roll < 4 ? 1 : 0;   // 40% chance of 1 defender
  if (roll < 3) return 2;                               // 30% chance of 2 defenders
  if (roll < 7) return 1;                               // 40% chance of 1 defender
  return 0;                                             // 30% no defenders
}

function rusherIntents(state: GameState, player: PlayerState): SurvivorIntent[] {
  const survivors = getActiveSurvivors(player);
  if (survivors.length === 0) return [];

  // Only care about food when critically starving; ignore wood/metal/meds pressure
  const res = player.compound.resources;
  const alive = survivors.length;
  const needs: Need[] = [];
  if (res.food + res.water < alive) needs.push({ resource: 'food', urgency: 10 });

  // Heavy item weight pulls toward weapon-rich locations (police_station)
  const scoredLocs = scoreLocations(state, player, needs, 6.0);
  const best = scoredLocs.find((l) => l.score > 0);

  return survivors.map((sv) => {
    const action: SurvivorAction =
      sv.wellFed && sv.hp < sv.maxHp ? { type: 'rest' } :
      best ? { type: 'scavenge', locationId: best.id } : { type: 'defend' };
    return { survivorId: sv.id, action };
  });
}

function hoarderIntents(state: GameState, player: PlayerState): SurvivorIntent[] {
  const survivors = getActiveSurvivors(player);
  if (survivors.length === 0) return [];

  const res = player.compound.resources;
  // Always hungry for food+water regardless of current stock
  const needs: Need[] = [
    { resource: 'food', urgency: 8 },
    { resource: 'water', urgency: 6 },
  ];
  if (res.meds === 0) needs.push({ resource: 'meds', urgency: 4 });

  // Very low item weight: ignores weapons, goes to grocery/reservoir
  const scoredLocs = scoreLocations(state, player, needs, 0.3);
  const best = scoredLocs.find((l) => l.score > 0);

  return survivors.map((sv) => {
    const action: SurvivorAction =
      sv.wellFed && sv.hp < sv.maxHp ? { type: 'rest' } :
      best ? { type: 'scavenge', locationId: best.id } : { type: 'defend' };
    return { survivorId: sv.id, action };
  });
}

function raiderIntents(state: GameState, player: PlayerState): SurvivorIntent[] {
  const survivors = getActiveSurvivors(player);
  if (survivors.length === 0) return [];

  // Find the strongest survivor
  const sorted = [...survivors].sort((a, b) => b.baseThreat - a.baseThreat);
  const strongest = sorted[0];
  const rest = sorted.slice(1);

  // Find the weakest opponent (fewest alive survivors, not self, not eliminated)
  const opponents = state.players.filter((p) => p.id !== player.id && !p.isEliminated);
  const weakest = opponents.sort(
    (a, b) =>
      a.survivors.filter((s) => s.alive).length -
      b.survivors.filter((s) => s.alive).length,
  )[0];

  const needs = assessNeeds(player);
  const scoredLocs = scoreLocations(state, player, needs, 1.5);
  const best = scoredLocs.find((l) => l.score > 0);
  const fallbackAction = (sv: SurvivorState): SurvivorAction =>
    sv.wellFed && sv.hp < sv.maxHp ? { type: 'rest' } :
    best ? { type: 'scavenge', locationId: best.id } : { type: 'defend' };

  // Attack only if we have a strong raider and a valid target
  const attackAction: SurvivorAction =
    strongest.baseThreat >= 4 && weakest
      ? { type: 'attack', targetPlayerId: weakest.id }
      : fallbackAction(strongest);

  return [
    { survivorId: strongest.id, action: attackAction },
    ...rest.map((sv) => ({ survivorId: sv.id, action: fallbackAction(sv) })),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// NEEDS
// ─────────────────────────────────────────────────────────────────────────────

interface Need { resource: ResourceType; urgency: number }

function assessNeeds(player: PlayerState): Need[] {
  const res = player.compound.resources;
  const alive = player.survivors.filter((s) => s.alive).length;
  const needs: Need[] = [];

  const sustenance = res.food + res.water;
  if (sustenance < alive)           needs.push({ resource: 'food', urgency: 10 });
  else if (sustenance < alive * 2)  needs.push({ resource: 'food', urgency: 6 });
  else if (sustenance < alive * 4)  needs.push({ resource: 'food', urgency: 3 });

  if (res.food < alive)             needs.push({ resource: 'water', urgency: 4 });

  if (res.meds === 0)               needs.push({ resource: 'meds', urgency: 5 });
  else if (res.meds < 3)            needs.push({ resource: 'meds', urgency: 2 });

  if (res.wood < 4)                 needs.push({ resource: 'wood', urgency: 2 });
  if (res.metal < 3)                needs.push({ resource: 'metal', urgency: 2 });

  return needs.sort((a, b) => b.urgency - a.urgency);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────────────────────

interface ScoredLocation { id: LocationId; score: number }

function scoreLocations(
  state: GameState,
  player: PlayerState,
  needs: Need[],
  itemWeight: number,
): ScoredLocation[] {
  return state.locations
    .filter((loc) => loc.lootDeck.length > 0)
    .map((loc) => ({
      id: loc.id,
      score: scoreLocation(loc, needs, itemWeight, player.id, state.rngSeed, state.round),
    }))
    .sort((a, b) => b.score - a.score);
}

function scoreLocation(
  loc: LocationState,
  needs: Need[],
  itemWeight: number,
  playerId: string,
  seed: number,
  round: number,
): number {
  const locResources = LOCATION_RESOURCES[loc.id] ?? [];
  let score = 0;

  for (const need of needs) {
    if (!locResources.includes(need.resource)) continue;
    const count = loc.lootDeck.filter(
      (t) => t.kind === 'resource' && t.resource === need.resource,
    ).length;
    score += need.urgency * Math.log1p(count);
  }

  const items = loc.lootDeck.filter((t) => t.kind !== 'resource').length;
  score += items * itemWeight;

  score += Math.log1p(loc.lootDeck.length) * 0.4;

  score *= jitter(playerId, loc.id, round, seed);

  return score;
}

/** Deterministic [1.0, 1.2] multiplier — varies per game seed so no player has a fixed advantage. */
function jitter(playerId: string, locId: LocationId, round: number, seed: number): number {
  let h = (seed ^ round) * 2654435761;
  for (const c of playerId + locId) h = Math.imul(h ^ c.charCodeAt(0), 2246822519);
  return 1 + (Math.abs(h) % 21) * 0.01;
}
