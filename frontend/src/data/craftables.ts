import type { ItemId, ResourceType } from '@game/types';
import itemDefs from '@game/data/item-defs.json';

export type CraftKind = 'weapon' | 'equipment' | 'structure';

export interface CraftableDef {
  id: ItemId;
  kind: CraftKind;
  name: string;
  craftCost: Partial<Record<ResourceType, number>>;
  effect: string;
}

interface RawDef {
  id: string;
  name: string;
  craftable?: boolean;
  craftCost?: Partial<Record<ResourceType, number>>;
  effect?: string;
  threatBonus?: number;
  requiresAmmo?: boolean;
  compoundThreatBonus?: number;
}

function describeWeapon(d: RawDef): string {
  return `+${d.threatBonus} threat${d.requiresAmmo ? ' (requires ammo)' : ''}`;
}

function describeStructure(d: RawDef): string {
  const parts: string[] = [];
  if (d.compoundThreatBonus) parts.push(`+${d.compoundThreatBonus} compound threat`);
  if (d.effect) parts.push(d.effect);
  return parts.join(' — ') || 'No additional effect.';
}

function buildDefs(defs: RawDef[], kind: CraftKind): CraftableDef[] {
  return defs
    .filter((d) => d.craftable !== false && d.craftCost)
    .map((d) => ({
      id: d.id as ItemId,
      kind,
      name: d.name,
      craftCost: d.craftCost!,
      effect:
        kind === 'weapon' ? describeWeapon(d) : kind === 'structure' ? describeStructure(d) : d.effect ?? 'No additional effect.',
    }));
}

/** Derived from item-defs.json (the engine's source of truth) rather than duplicated by hand. */
export const CRAFTABLE_DEFS: CraftableDef[] = [
  ...buildDefs(itemDefs.weapons, 'weapon'),
  ...buildDefs(itemDefs.equipment, 'equipment'),
  ...buildDefs(itemDefs.structures, 'structure'),
];
