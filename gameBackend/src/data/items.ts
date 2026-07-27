import { WeaponId, EquipmentId, StructureId, ResourceType } from '../types';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Item definitions — edit src/data/item-defs.json to add, change, or remove items.
// New item IDs also need to be added to the union types in src/types.ts.
// ─────────────────────────────────────────────────────────────────────────────

export interface WeaponDef {
  id: WeaponId;
  name: string;
  threatBonus: number;
  requiresAmmo: boolean;
  craftable: boolean;
  craftCost?: Partial<Record<ResourceType, number>>;
}

export interface EquipmentDef {
  id: EquipmentId;
  name: string;
  extraSlots: number;
  consumable: boolean;
  craftable: boolean;
  craftCost?: Partial<Record<ResourceType, number>>;
  effect?: string;
}

export interface StructureDef {
  id: StructureId;
  name: string;
  compoundThreatBonus: number;
  craftCost: Partial<Record<ResourceType, number>>;
  effect?: string;
  wakesRestingSurvivors?: boolean;
  generates?: { resource: ResourceType; amount: number; everyNRounds?: number };
}

interface ItemsJson {
  weapons: Array<WeaponDef & { craftCost?: Record<string, number> }>;
  equipment: Array<EquipmentDef & { craftCost?: Record<string, number> }>;
  structures: Array<StructureDef & { craftCost?: Record<string, number> }>;
}

const itemsJson: ItemsJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'item-defs.json'), 'utf-8'),
);

export const WEAPON_DEFS: Record<WeaponId, WeaponDef> = Object.fromEntries(
  itemsJson.weapons.map((w) => [w.id, w]),
) as Record<WeaponId, WeaponDef>;

export const EQUIPMENT_DEFS: Record<EquipmentId, EquipmentDef> = Object.fromEntries(
  itemsJson.equipment.map((e) => [e.id, e]),
) as Record<EquipmentId, EquipmentDef>;

export const STRUCTURE_DEFS: Record<StructureId, StructureDef> = Object.fromEntries(
  itemsJson.structures.map((s) => [s.id, s]),
) as Record<StructureId, StructureDef>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers used by crafting resolution and CLI
// ─────────────────────────────────────────────────────────────────────────────

export type CraftableDef =
  | { kind: 'weapon'; def: WeaponDef }
  | { kind: 'equipment'; def: EquipmentDef }
  | { kind: 'structure'; def: StructureDef };

export function getCraftableDef(itemId: string): CraftableDef | null {
  const weapon = itemsJson.weapons.find((w) => w.id === itemId);
  if (weapon && weapon.craftable) return { kind: 'weapon', def: weapon };

  const equip = itemsJson.equipment.find((e) => e.id === itemId);
  if (equip && equip.craftable) return { kind: 'equipment', def: equip };

  const structure = itemsJson.structures.find((s) => s.id === itemId);
  if (structure) return { kind: 'structure', def: structure };

  return null;
}

export function allCraftables(): CraftableDef[] {
  return [
    ...itemsJson.weapons.filter((w) => w.craftable).map((w) => ({ kind: 'weapon' as const, def: w })),
    ...itemsJson.equipment.filter((e) => e.craftable).map((e) => ({ kind: 'equipment' as const, def: e })),
    ...itemsJson.structures.map((s) => ({ kind: 'structure' as const, def: s })),
  ];
}
