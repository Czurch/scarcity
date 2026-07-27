import type { LootToken } from '@game/types';
import { getItemArt, getResourceArt } from './itemArt';

export function isCarryLimited(token: LootToken): boolean {
  return token.kind === 'weapon' || token.kind === 'equipment';
}

export function tokenLabel(token: LootToken): string {
  if (token.kind === 'weapon') return token.weaponId;
  if (token.kind === 'equipment') return token.equipmentId;
  if (token.kind === 'resource') return `${token.resource} x${token.amount}`;
  return 'Picked Clean';
}

export function tokenArt(token: LootToken): string | null {
  if (token.kind === 'weapon') return getItemArt(token.weaponId);
  if (token.kind === 'equipment') return getItemArt(token.equipmentId);
  if (token.kind === 'resource') return getResourceArt(token.resource);
  return null;
}
