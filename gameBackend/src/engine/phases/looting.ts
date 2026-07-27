import { GameState, GameReducerAction, LootOpportunity, ResourceType } from '../../types';
import { applyTokenToPlayer, tokenLabel, addEvent } from '../helpers';
import { createRng } from '../../utils/rng';

/**
 * Human player claims their loot opportunity by choosing token indices.
 * Resources: any number can be taken. Weapons/equipment: limited to carryCapacity (free item slots).
 */
export function applyClaimLoot(
  state: GameState,
  action: Extract<GameReducerAction, { type: 'CLAIM_LOOT' }>,
): GameState {
  if (state.phase !== 'looting') return state;

  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const opp = s.lootOpportunities.find((o) => o.id === action.lootId);
  if (!opp || opp.claimed) return s;

  // Resources are unlimited; weapons/equipment capped at carryCapacity (free item slots)
  let itemSlotsTaken = 0;
  const picks = action.tokenIndices.filter((idx) => {
    const token = opp.revealedTokens[idx];
    if (!token) return false;
    if (token.kind === 'resource') return true;
    if (itemSlotsTaken < opp.carryCapacity) { itemSlotsTaken++; return true; }
    return false;
  });
  claimLoot(s, opp, picks, action.assignments);

  if (allLootClaimed(s)) {
    s.phase = 'upkeep';
    s.upkeepAllocations = {};
    addEvent(s, 'All loot claimed. Upkeep begins...', ['phase']);
  }
  return s;
}

/** Auto-claim loot for a player using a greedy priority (resources > weapons > equipment). */
export function autoClaimLoot(state: GameState, playerId: string): void {
  const opp = state.lootOpportunities.find((o) => o.playerId === playerId && !o.claimed);
  if (!opp) return;

  const picks = greedyPickIndices(opp);
  claimLoot(state, opp, picks);
}

/** Auto-claim for a compound raid (choose between dealing damage OR taking resources). */
export function autoClaimRaid(state: GameState, opp: LootOpportunity): void {
  // Simple AI heuristic: if defender has few survivors, choose damage; otherwise take resources.
  if (opp.target.kind !== 'compound') return;

  const attacker = state.players.find((p) => p.id === opp.playerId)!;
  const compoundTarget = opp.target as Extract<LootOpportunity['target'], { kind: 'compound' }>;
  const defender = state.players.find((p) => p.id === compoundTarget.defenderId)!;

  const defenderSurvivorCount = defender.survivors.filter((s) => s.alive).length;

  if (defenderSurvivorCount <= 2) {
    // Damage route: pick a random alive survivor and damage them
    const target = defender.survivors.find((s) => s.alive);
    if (target) {
      target.hp = Math.max(0, target.hp - 1);
      addEvent(state, `${attacker.name} chooses to injure ${target.name} (${defender.name}) during raid! [${target.hp}/${target.maxHp}]`, ['raid', 'damage']);
      if (target.hp <= 0) {
        target.alive = false;
        addEvent(state, `☠ ${target.name} has died.`, ['death']);
        if (defender.survivors.every((s) => !s.alive)) {
          defender.isEliminated = true;
          addEvent(state, `${defender.name} has been eliminated!`, ['elimination']);
        }
      }
    }
  } else {
    // Resource route
    const picks = greedyPickIndices(opp);
    for (const idx of picks) {
      const token = opp.revealedTokens[idx];
      if (!token) continue;
      // Remove from defender's compound
      if (token.kind === 'resource') {
        const cur = defender.compound.resources[token.resource];
        const take = Math.min(token.amount, cur);
        defender.compound.resources[token.resource] -= take;
        attacker.compound.resources[token.resource] += take;
        addEvent(state, `${attacker.name} loots ${take}x ${token.resource} from ${defender.name}.`, ['raid', 'loot']);
      }
    }
  }
  opp.claimed = true;
}

export function resolveAllLoot(state: GameState): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;

  for (const opp of s.lootOpportunities) {
    if (opp.claimed) continue;
    const player = s.players.find((p) => p.id === opp.playerId);
    if (!player || player.isEliminated) { opp.claimed = true; continue; }

    if (opp.target.kind === 'compound') {
      autoClaimRaid(s, opp);
    } else {
      const picks = greedyPickIndices(opp);
      claimLoot(s, opp, picks);
    }
  }

  s.phase = 'upkeep';
  s.upkeepAllocations = {};
  addEvent(s, 'All loot claimed. Upkeep begins...', ['phase']);
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────

function claimLoot(
  state: GameState,
  opp: LootOpportunity,
  tokenIndices: number[],
  assignments?: Record<number, string>,
): void {
  const player = state.players.find((p) => p.id === opp.playerId)!;
  const taken: string[] = [];

  const compoundTarget = opp.target.kind === 'compound'
    ? (opp.target as Extract<LootOpportunity['target'], { kind: 'compound' }>)
    : null;
  const defender = compoundTarget
    ? state.players.find((p) => p.id === compoundTarget.defenderId)
    : null;

  for (const idx of tokenIndices) {
    const token = opp.revealedTokens[idx];
    if (!token || token.kind === 'nothing') continue;

    if (opp.target.kind === 'location') {
      const preferSurvivorId = assignments?.[idx] ?? opp.survivorIds[tokenIndices.indexOf(idx)];
      applyTokenToPlayer(player, token, preferSurvivorId);
      taken.push(tokenLabel(token));
    } else if (opp.target.kind === 'compound') {
      if (token.kind === 'resource' && defender) {
        const available = defender.compound.resources[token.resource as ResourceType];
        const take = Math.min(token.amount, available);
        if (take > 0) {
          defender.compound.resources[token.resource as ResourceType] -= take;
          player.compound.resources[token.resource as ResourceType] += take;
          taken.push(tokenLabel({ ...token, amount: take }));
        }
      } else if (token.kind !== 'resource') {
        // Items looted from a compound go to the raider's compound pool
        applyTokenToPlayer(player, token);
        taken.push(tokenLabel(token));
      }
    }
  }

  // Unchosen non-nothing tokens return to the TOP of the location deck (shuffled)
  if (opp.target.kind === 'location') {
    const loc = state.locations.find((l) => l.id === (opp.target as any).locationId)!;
    const toReturn = opp.revealedTokens
      .filter((t, i) => !tokenIndices.includes(i) && t.kind !== 'nothing');

    if (toReturn.length > 0) {
      const rng = createRng(state.rngSeed + state.rngCounter++);
      rng.shuffle(toReturn);
      loc.lootDeck.unshift(...toReturn);
    }
  }

  opp.claimed = true;
  if (taken.length > 0) {
    addEvent(state, `${player.name} loots: ${taken.join(', ')}`, ['loot']);
  } else {
    addEvent(state, `${player.name} loots nothing.`, ['loot']);
  }
}

function greedyPickIndices(opp: LootOpportunity): number[] {
  const itemPriority = (token: LootOpportunity['revealedTokens'][0]): number => {
    if (token.kind === 'weapon') return 4;
    if (token.kind === 'equipment') return 2;
    return 0;
  };

  const resourceIndices: number[] = [];
  const itemEntries: { i: number; p: number }[] = [];

  opp.revealedTokens.forEach((t, i) => {
    if (t.kind === 'nothing') return;  // Picked Clean — skip
    if (t.kind === 'resource') {
      resourceIndices.push(i);
    } else {
      itemEntries.push({ i, p: itemPriority(t) });
    }
  });

  // Take all resources; take weapons/equipment up to available item slots
  itemEntries.sort((a, b) => b.p - a.p);
  const itemIndices = itemEntries.slice(0, opp.carryCapacity).map((x) => x.i);

  return [...resourceIndices, ...itemIndices];
}

function allLootClaimed(state: GameState): boolean {
  return state.lootOpportunities.every((o) => o.claimed);
}
