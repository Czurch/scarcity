import { LocationId, LocationLootConfig, LootToken, LocationState } from '../types';
import { Rng } from '../utils/rng';

export interface LocationDef {
  id: LocationId;
  name: string;
  description: string;
}

export const LOCATION_DEFS: Record<LocationId, LocationDef> = {
  mini_mart:      { id: 'mini_mart',      name: 'Mini Mart',       description: 'Water, Food, Meds' },
  police_station: { id: 'police_station', name: 'Police Station',  description: 'Weapons, Ammo, Metal' },
  reservoir:      { id: 'reservoir',      name: 'Reservoir',       description: 'Water (large supply)' },
  mall:           { id: 'mall',           name: 'Mall',            description: 'All resources' },
  hospital:       { id: 'hospital',       name: 'Hospital',        description: 'Meds, Food, Water' },
  woods:          { id: 'woods',          name: 'Woods',           description: 'Wood, Food, Water' },
  commercial:     { id: 'commercial',     name: 'Commercial',      description: 'Metal, Wood, Food, Water' },
  residential:    { id: 'residential',    name: 'Residential',     description: 'All resources (modest)' },
  grocery:        { id: 'grocery',        name: 'Grocery',         description: 'Food, Water (large supply)' },
};

/**
 * Default loot deck configurations.
 * Each number = count of tokens of that type added to the deck.
 * Tune these values during balance testing.
 */
export const DEFAULT_LOOT_CONFIGS: Record<LocationId, LocationLootConfig> = {
  mini_mart: {
    resources: { water: 6, food: 5, meds: 3 },
  },
  police_station: {
    resources: { metal: 8, ammo: 4 },
    weapons: { wooden_club: 2, lead_pipe: 1, sawbat: 1, handgun: 1, snubnose: 1 },
  },
  reservoir: {
    resources: { water: 20 },
  },
  mall: {
    resources: { water: 4, food: 4, meds: 2, wood: 3, metal: 3, ammo: 2 },
    weapons: { wooden_club: 1, lead_pipe: 1 },
    equipment: { backpack: 1 },
  },
  hospital: {
    resources: { meds: 10, food: 4, water: 4 },
  },
  woods: {
    resources: { wood: 12, food: 5, water: 3 },
  },
  commercial: {
    resources: { metal: 10, wood: 6, food: 3, water: 3 },
  },
  residential: {
    resources: { water: 4, food: 4, meds: 2, wood: 3, metal: 2 },
    weapons: { wooden_club: 1 },
    equipment: { backpack: 1, flashlight: 1 },
  },
  grocery: {
    resources: { food: 15, water: 8 },
  },
};

/**
 * Expand a LocationLootConfig into a shuffled array of LootTokens.
 * Resource amounts are the count of *individual tokens*, each representing 1 unit.
 * (e.g. resources: { water: 6 } → 6 ResourceTokens with amount:1)
 */
export function buildLootDeck(config: LocationLootConfig, rng: Rng): LootToken[] {
  const tokens: LootToken[] = [];

  if (config.resources) {
    for (const [res, count] of Object.entries(config.resources)) {
      for (let i = 0; i < (count ?? 0); i++) {
        tokens.push({ kind: 'resource', resource: res as any, amount: 1 });
      }
    }
  }

  if (config.weapons) {
    for (const [weapon, count] of Object.entries(config.weapons)) {
      for (let i = 0; i < (count ?? 0); i++) {
        tokens.push({ kind: 'weapon', weaponId: weapon as any });
      }
    }
  }

  if (config.equipment) {
    for (const [eq, count] of Object.entries(config.equipment)) {
      for (let i = 0; i < (count ?? 0); i++) {
        tokens.push({ kind: 'equipment', equipmentId: eq as any });
      }
    }
  }

  // ~15% of final deck is "Picked Clean" cards (ceil(N / 6) ≈ 1-in-6)
  const nothingCount = Math.ceil(tokens.length / 6);
  for (let i = 0; i < nothingCount; i++) {
    tokens.push({ kind: 'nothing' });
  }

  return rng.shuffle(tokens);
}

export function buildLocationStates(
  configs: Partial<Record<LocationId, LocationLootConfig>>,
  rng: Rng,
): LocationState[] {
  return (Object.keys(LOCATION_DEFS) as LocationId[]).map((id) => {
    const config = configs[id] ?? DEFAULT_LOOT_CONFIGS[id];
    return {
      id,
      name: LOCATION_DEFS[id].name,
      lootDeck: buildLootDeck(config, rng),
    };
  });
}
