import {
  GameState,
  PlayerState,
  SurvivorState,
  LootToken,
  ResourceType,
  WeaponToken,
  CompoundState,
  StructureId,
} from "../types";
import { WEAPON_DEFS, STRUCTURE_DEFS } from "../data/items";

// ─────────────────────────────────────────────────────────────────────────────
// SURVIVOR HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Effective threat = base + best equipped weapon bonus (ammo required for guns) + 1 if well-fed. */
export function getSurvivorThreat(survivor: SurvivorState, ammoInCompound = 0): number {
  const hasAmmo = ammoInCompound > 0;
  let bestWeaponBonus = 0;
  const hasHandCart = survivor.equippedItems.some(
    (item) => item?.kind === 'equipment' && item.equipmentId === 'hand_cart',
  );
  if (!hasHandCart) {
    for (const item of survivor.equippedItems) {
      if (item?.kind === "weapon") {
        const def = WEAPON_DEFS[item.weaponId];
        if (!def.requiresAmmo || hasAmmo) {
          bestWeaponBonus = Math.max(bestWeaponBonus, def.threatBonus);
        }
      }
    }
  }
  return survivor.baseThreat + bestWeaponBonus + (survivor.wellFed ? 1 : 0);
}

/** Max item slots = 2 base + backpack/hand-cart bonuses (each occupies 1 slot itself). */
export function getMaxSlots(survivor: SurvivorState): number {
  let slots = 2;
  for (const item of survivor.equippedItems) {
    if (item?.kind === "equipment") {
      if (item.equipmentId === "backpack") slots += 2;    // net +1 after occupying a slot
      if (item.equipmentId === "hand_cart") slots += 3;   // net +2 after occupying a slot
      if (item.equipmentId === "flashlight") slots += 1;  // net 0 — doesn't occupy a slot
    }
  }
  return slots;
}

/** Number of extra cards revealed when scavenging, from equipped flashlights (stacks). */
export function getFlashlightBonus(survivor: SurvivorState): number {
  return survivor.equippedItems.filter(
    (item) => item?.kind === "equipment" && item.equipmentId === "flashlight",
  ).length;
}

export function hasFreeSlot(survivor: SurvivorState): boolean {
  const max = getMaxSlots(survivor);
  return survivor.equippedItems.filter(Boolean).length < max;
}

export function survivorCarryCapacity(survivor: SurvivorState): number {
  let cap = 1;
  for (const item of survivor.equippedItems) {
    if (item?.kind === "equipment") {
      if (item.equipmentId === "backpack") cap += 2;
      if (item.equipmentId === "hand_cart") cap += 3;
    }
  }
  return cap;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOUND HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function computeStructureThreat(compound: CompoundState): number {
  return compound.structures.reduce((sum, s) => {
    return sum + STRUCTURE_DEFS[s.id].compoundThreatBonus;
  }, 0);
}

export function hasStructure(
  compound: CompoundState,
  id: StructureId,
): boolean {
  return compound.structures.some((s) => s.id === id);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getActiveSurvivors(player: PlayerState): SurvivorState[] {
  return player.survivors.filter((s) => s.alive);
}

export function getCompoundThreat(
  player: PlayerState,
  includeResting: boolean,
  jammedPlayerIds: string[] = [],
): number {
  const wakesResting =
    !jammedPlayerIds.includes(player.id) &&
    hasStructure(player.compound, "electric_fence_alarm");
  const defenders = player.survivors.filter((s) => {
    if (!s.alive) return false;
    const intent = player.intents.find((i) => i.survivorId === s.id);
    if (!intent) return false;
    if (intent.action.type === "defend") return true;
    if (includeResting && wakesResting &&
        (intent.action.type === "rest" || intent.action.type === "craft"))
      return true;
    return false;
  });
  const ammo = player.compound.resources.ammo;
  const defenderThreat = defenders.reduce(
    (sum, s) => sum + getSurvivorThreat(s, ammo) + 1,
    0,
  );
  return defenderThreat + player.compound.structureThreat;
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME STATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const p = state.players.find((p) => p.id === playerId);
  if (!p) throw new Error(`Player not found: ${playerId}`);
  return p;
}

export function getSurvivor(
  state: GameState,
  survivorId: string,
): SurvivorState {
  for (const p of state.players) {
    const s = p.survivors.find((s) => s.id === survivorId);
    if (s) return s;
  }
  throw new Error(`Survivor not found: ${survivorId}`);
}

export function getLocation(state: GameState, locationId: string) {
  const loc = state.locations.find((l) => l.id === locationId);
  if (!loc) throw new Error(`Location not found: ${locationId}`);
  return loc;
}

/** Return active (non-eliminated) players. */
export function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.isEliminated);
}

/** Token display label for logs. */
export function tokenLabel(token: LootToken): string {
  if (token.kind === "resource") return `${token.amount}x ${token.resource}`;
  if (token.kind === "weapon") return token.weaponId.replace(/_/g, " ");
  if (token.kind === "equipment") return token.equipmentId.replace(/_/g, " ");
  return "Picked Clean";
}

/** Apply a loot token to a player: resources go to compound, weapons/equipment equip to a survivor. */
export function applyTokenToPlayer(
  player: PlayerState,
  token: LootToken,
  preferSurvivorId?: string,
): void {
  if (token.kind === "resource") {
    player.compound.resources[token.resource] += token.amount;
    return;
  }
  // Try to equip to the preferred survivor first, then any survivor with a free slot
  const ordered = preferSurvivorId
    ? [
        player.survivors.find((s) => s.id === preferSurvivorId && s.alive),
        ...player.survivors.filter((s) => s.id !== preferSurvivorId && s.alive),
      ].filter(Boolean)
    : player.survivors.filter((s) => s.alive);

  for (const s of ordered as SurvivorState[]) {
    const blockedByHandCart = token.kind === 'weapon' &&
      s.equippedItems.some((item) => item?.kind === 'equipment' && item.equipmentId === 'hand_cart');
    if (!blockedByHandCart && hasFreeSlot(s)) {
      s.equippedItems = [...s.equippedItems.filter(Boolean), token];
      return;
    }
  }
  // No survivor has a free slot — store it in the compound instead of losing it.
  // The player can equip it onto a survivor later (planning phase) via transferItem-style actions.
  player.compound.storedItems.push(token);
}

export function addEvent(
  state: GameState,
  message: string,
  tags: string[] = [],
): void {
  state.events.push({ round: state.round, phase: state.phase, message, tags });
}
