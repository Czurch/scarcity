import { GameState, PlayerState, ResourceType, LootToken, StructureId } from '../../types';
import { addEvent, computeStructureThreat, getMaxSlots, hasFreeSlot } from '../helpers';
import { getCraftableDef } from '../../data/items';

export function resolveCrafting(state: GameState): void {
  for (const player of state.players) {
    if (player.isEliminated) continue;
    for (const intent of player.intents) {
      if (intent.action.type !== 'craft') continue;

      const sv = player.survivors.find((s) => s.id === intent.survivorId);
      if (!sv || !sv.alive) continue;

      const { itemId } = intent.action;
      const entry = getCraftableDef(itemId);

      if (!entry) {
        addEvent(state, `${sv.name} (${player.name}) can't craft ${itemId} — not a craftable item.`, ['craft']);
        state.craftResults.push({ playerId: player.id, survivorId: sv.id, itemId, outcome: 'failed', reason: 'not a craftable item' });
        continue;
      }

      const cost = entry.def.craftCost ?? {};
      if (!canAfford(player, cost)) {
        addEvent(state, `${sv.name} (${player.name}) can't afford to craft ${entry.def.name}.`, ['craft']);
        state.craftResults.push({ playerId: player.id, survivorId: sv.id, itemId, outcome: 'failed', reason: `can't afford ${entry.def.name}` });
        continue;
      }

      // Deduct costs
      for (const [res, amount] of Object.entries(cost)) {
        player.compound.resources[res as ResourceType] -= amount as number;
      }

      if (entry.kind === 'structure') {
        const alreadyBuilt = player.compound.structures.some((s) => s.id === entry.def.id);
        if (alreadyBuilt) {
          addEvent(state, `${player.name} already has ${entry.def.name} built — resources refunded.`, ['craft']);
          for (const [res, amount] of Object.entries(cost)) {
            player.compound.resources[res as ResourceType] += amount as number;
          }
          state.craftResults.push({ playerId: player.id, survivorId: sv.id, itemId, outcome: 'failed', reason: `${entry.def.name} already built` });
          continue;
        }
        player.compound.structures.push({ id: entry.def.id as StructureId, builtOnRound: state.round });
        player.compound.structureThreat = computeStructureThreat(player.compound);
        addEvent(state, `${player.name} builds ${entry.def.name}!`, ['craft', 'structure']);
        state.craftResults.push({ playerId: player.id, survivorId: sv.id, itemId, outcome: 'built' });

      } else {
        // Weapon or equipment — equip to the crafting survivor if possible, else any survivor
        const token: LootToken = entry.kind === 'weapon'
          ? { kind: 'weapon', weaponId: entry.def.id as any }
          : { kind: 'equipment', equipmentId: entry.def.id as any };

        const target = hasFreeSlot(sv)
          ? sv
          : player.survivors.find((s) => s.alive && hasFreeSlot(s));

        if (target) {
          target.equippedItems = [...target.equippedItems.filter(Boolean), token];
          addEvent(state, `${sv.name} (${player.name}) crafts ${entry.def.name} → equipped to ${target.name}.`, ['craft']);
          state.craftResults.push({
            playerId: player.id,
            survivorId: sv.id,
            itemId,
            outcome: 'equipped',
            equippedToSurvivorId: target.id !== sv.id ? target.id : undefined,
          });
        } else {
          player.compound.storedItems.push(token);
          addEvent(state, `${sv.name} (${player.name}) crafts ${entry.def.name} — no survivor has a free slot, stored in compound.`, ['craft']);
          state.craftResults.push({ playerId: player.id, survivorId: sv.id, itemId, outcome: 'stored' });
        }
      }
    }
  }
}

function canAfford(player: PlayerState, cost: Partial<Record<ResourceType, number>>): boolean {
  for (const [res, amount] of Object.entries(cost)) {
    if ((player.compound.resources[res as ResourceType] ?? 0) < (amount as number)) return false;
  }
  return true;
}
