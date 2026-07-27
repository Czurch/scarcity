import type { ItemId, ResourceType } from '@game/types';

import woodenClub from '../../assets/tokens/Nightstick-Token.png';
import leadPipe from '../../assets/tokens/LeadPipe-Token.png';
import sawbat from '../../assets/tokens/SawBat-Token.png';
import handgun from '../../assets/tokens/Colt-Token.png';
import snubnose from '../../assets/tokens/Snubnose-Token.png';
import metal from '../../assets/tokens/Scrap-Token.png';
import food from '../../assets/tokens/Rations-Token.png';
import water from '../../assets/tokens/Water-Token.png';
import meds from '../../assets/tokens/Medkit-Token.png';
import ammo from '../../assets/tokens/Ammo-Token.png';

/**
 * Art filenames don't line up 1:1 with item ids (real names baked into the
 * card art vs generic engine ids) — this mapping was confirmed with the
 * game designer rather than guessed. `pipe_gun`, `rifle`, and `wood` have no
 * art yet; callers should render a text fallback when this returns null.
 */
const ITEM_ART: Partial<Record<ItemId, string>> = {
  wooden_club: woodenClub,
  lead_pipe: leadPipe,
  sawbat,
  handgun,
  snubnose,
};

const RESOURCE_ART: Partial<Record<ResourceType, string>> = {
  metal,
  food,
  water,
  meds,
  ammo,
};

export function getItemArt(id: ItemId): string | null {
  return ITEM_ART[id] ?? null;
}

export function getResourceArt(id: ResourceType): string | null {
  return RESOURCE_ART[id] ?? null;
}
