import type { SurvivorState } from '@game/types';
import itemDefs from '@game/data/item-defs.json';

interface WeaponDefLike {
  id: string;
  name: string;
  threatBonus: number;
  requiresAmmo: boolean;
}

const WEAPON_THREAT: Record<string, { name: string; threatBonus: number; requiresAmmo: boolean }> = Object.fromEntries(
  (itemDefs.weapons as WeaponDefLike[]).map((w) => [w.id, { name: w.name, threatBonus: w.threatBonus, requiresAmmo: w.requiresAmmo }]),
);

export interface ThreatContribution {
  label: string;
  amount: number;
}

/**
 * Mirrors gameBackend/src/engine/helpers.ts's getSurvivorThreat: best equipped
 * weapon bonus (guns need compound ammo) plus +1 if well-fed this round. Returned
 * as individual contributions so the UI can show a breakdown, not just the total.
 */
export function getThreatBreakdown(
  survivor: SurvivorState,
  ammoInCompound: number,
  wellFedOverride?: boolean,
): ThreatContribution[] {
  const hasAmmo = ammoInCompound > 0;
  const contributions: ThreatContribution[] = [];

  let best: { name: string; threatBonus: number } | null = null;
  for (const item of survivor.equippedItems) {
    if (item?.kind === 'weapon') {
      const def = WEAPON_THREAT[item.weaponId];
      if (def && (!def.requiresAmmo || hasAmmo) && (!best || def.threatBonus > best.threatBonus)) {
        best = def;
      }
    }
  }
  if (best) contributions.push({ label: best.name, amount: best.threatBonus });

  const wellFed = wellFedOverride ?? survivor.wellFed;
  if (wellFed) contributions.push({ label: 'Well Fed', amount: 1 });

  return contributions;
}

export function getThreatDelta(survivor: SurvivorState, ammoInCompound: number): number {
  return getThreatBreakdown(survivor, ammoInCompound).reduce((sum, c) => sum + c.amount, 0);
}

/**
 * Mirrors gameBackend/src/engine/helpers.ts's getMaxSlots. The backend only ever stores
 * *filled* slots in equippedItems (empty slots are stripped, not kept as nulls — see
 * applyTokenToPlayer), so this is the only way to know how many slots a survivor actually has.
 */
export function getMaxGearSlots(survivor: SurvivorState): number {
  let slots = 2;
  for (const item of survivor.equippedItems) {
    if (item?.kind === 'equipment') {
      if (item.equipmentId === 'backpack') slots += 2;
      if (item.equipmentId === 'hand_cart') slots += 3;
      if (item.equipmentId === 'flashlight') slots += 1;
    }
  }
  return slots;
}
