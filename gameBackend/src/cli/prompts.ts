import * as readline from 'readline';
import { GameState, PlayerState, SurvivorIntent, SurvivorAction, LocationId, ItemId, UpkeepAllocations, SustenanceChoice, PlanningAllocations, ResourceType, EquipmentId } from '../types';
import { getActiveSurvivors, getMaxSlots, getSurvivorThreat } from '../engine/helpers';
import { allCraftables, CraftableDef, getCraftableDef } from '../data/items';
import { renderDraftPool, renderLootOpportunity, printError } from './display';
import { GameEngine } from '../GameEngine';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export function closeInput(): void {
  rl.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT PICK
// ─────────────────────────────────────────────────────────────────────────────

export async function promptDraftPick(engine: GameEngine, player: PlayerState): Promise<void> {
  const state = engine.getState();
  renderDraftPool(state as GameState);
  console.log(`\n  ${player.name}, pick a survivor by ID (e.g. "marcus"):`);

  while (true) {
    const input = (await ask('  > ')).trim().toLowerCase();
    const found = (state as GameState).draftPool.find((s) => s.id === input || s.name.toLowerCase() === input);
    if (found) {
      engine.draftPick(player.id, found.id);
      return;
    }
    printError(`"${input}" not in draft pool. Try again.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION SELECTION
// ─────────────────────────────────────────────────────────────────────────────

const LOCATIONS: LocationId[] = [
  'mini_mart', 'police_station', 'reservoir', 'mall', 'hospital',
  'woods', 'commercial', 'residential', 'grocery',
];

export async function promptIntents(engine: GameEngine, player: PlayerState): Promise<void> {
  const state = engine.getState() as GameState;
  // Re-read player from fresh state after any transfers
  const freshPlayer = (engine.getState() as GameState).players.find((p) => p.id === player.id)!;
  const survivors = getActiveSurvivors(freshPlayer);
  const intents: SurvivorIntent[] = [];
  const committedCosts: Partial<Record<ResourceType, number>> = {};

  console.log(`\n  Assign actions for ${freshPlayer.name}'s survivors:`);

  for (const sv of survivors) {
    const items = sv.equippedItems.filter(Boolean).map((i) =>
      i!.kind === 'weapon' ? i!.weaponId.replace(/_/g, ' ') : i!.kind === 'equipment' ? i!.equipmentId.replace(/_/g, ' ') : `${(i as any).amount}x ${(i as any).resource}`,
    );
    const slots = getMaxSlots(sv);
    const itemStr = items.length > 0 ? `  [${items.join(', ')}]` : `  [${slots} open slots]`;
    const threat = getSurvivorThreat(sv, freshPlayer.compound.resources.ammo);
    console.log(`\n  ${sv.name} (HP:${sv.hp}/${sv.maxHp} THR:${threat})${itemStr}`);
    const hasJammer = sv.equippedItems.some(
      (i) => i?.kind === 'equipment' && i.equipmentId === 'jammer',
    );
    const jammerStr = hasJammer ? '  [j] Jam' : '';
    const restStr = sv.wellFed && sv.hp < sv.maxHp ? '  [r] Rest+Heal' : '';
    console.log(`    [s] Scavenge  [a] Attack  [d] Defend  [c] Craft  [t] Trade${restStr}${jammerStr}`);
    const eff = (r: ResourceType) => Math.max(0, freshPlayer.compound.resources[r] - (committedCosts[r] ?? 0));
    console.log(`    Food: ${eff('food')}  Water: ${eff('water')}  Wood: ${eff('wood')}  Metal: ${eff('metal')}`);

    const action = await askAction(state, freshPlayer, committedCosts);
    intents.push({ survivorId: sv.id, action });

    if (action.type === 'craft') {
      const entry = getCraftableDef(action.itemId);
      for (const [r, n] of Object.entries(entry?.def.craftCost ?? {})) {
        committedCosts[r as ResourceType] = (committedCosts[r as ResourceType] ?? 0) + (n as number);
      }
    }
  }

  engine.submitIntents(freshPlayer.id, intents);
}

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export async function promptInventoryManagement(engine: GameEngine, player: PlayerState): Promise<void> {
  const getPlayer = () => (engine.getState() as GameState).players.find((p) => p.id === player.id)!;

  printInventory(getPlayer());
  console.log('\n  [m] Manage inventory   [enter] Continue to actions');
  const input = (await ask('  > ')).trim().toLowerCase();
  if (input !== 'm') return;

  while (true) {
    const p = getPlayer();
    const survivors = getActiveSurvivors(p);
    printInventory(p);

    console.log('\n  Move item — pick source survivor (number) or [done]:');
    survivors.forEach((sv, i) => console.log(`    [${i}] ${sv.name}`));
    const fromInput = (await ask('  > ')).trim().toLowerCase();
    if (fromInput === 'done' || fromInput === '') break;

    const fromIdx = parseInt(fromInput, 10);
    if (isNaN(fromIdx) || fromIdx < 0 || fromIdx >= survivors.length) {
      printError('Invalid selection.'); continue;
    }
    const fromSv = survivors[fromIdx];
    const items = fromSv.equippedItems
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item !== null);

    if (items.length === 0) {
      printError(`${fromSv.name} has no items to move.`); continue;
    }

    console.log(`  Items carried by ${fromSv.name}:`);
    items.forEach(({ item, i }) => {
      const label = item!.kind === 'weapon'
        ? item!.weaponId.replace(/_/g, ' ')
        : item!.kind === 'equipment'
          ? item!.equipmentId.replace(/_/g, ' ')
          : `${(item as any).amount}x ${(item as any).resource}`;
      console.log(`    [${i}] ${label}`);
    });

    const itemInput = (await ask('  Pick item index > ')).trim();
    const itemIdx = parseInt(itemInput, 10);
    if (isNaN(itemIdx) || !fromSv.equippedItems[itemIdx]) {
      printError('Invalid item index.'); continue;
    }

    console.log('  Move to which survivor?');
    survivors.filter((sv) => sv.id !== fromSv.id).forEach((sv, i) => {
      const free = getMaxSlots(sv) - sv.equippedItems.filter(Boolean).length;
      console.log(`    [${i}] ${sv.name}  (${free} free slot${free !== 1 ? 's' : ''})`);
    });
    const toPool = survivors.filter((sv) => sv.id !== fromSv.id);
    const toInput = (await ask('  > ')).trim();
    const toIdx = parseInt(toInput, 10);
    if (isNaN(toIdx) || toIdx < 0 || toIdx >= toPool.length) {
      printError('Invalid selection.'); continue;
    }
    const toSv = toPool[toIdx];
    const free = getMaxSlots(toSv) - toSv.equippedItems.filter(Boolean).length;
    if (free === 0) {
      printError(`${toSv.name} has no free item slots.`); continue;
    }

    engine.transferItem(player.id, fromSv.id, toSv.id, itemIdx);
    const updated = getPlayer();
    const updatedTo = updated.survivors.find((sv) => sv.id === toSv.id)!;
    console.log(`  ✓ Item moved to ${updatedTo.name}.`);
  }
}

function printInventory(player: PlayerState): void {
  console.log(`\n  ── Inventory: ${player.name} ──`);
  console.log(`  Food: ${player.compound.resources.food}  Water: ${player.compound.resources.water}  Meds: ${player.compound.resources.meds}  Ammo: ${player.compound.resources.ammo}`);
  for (const sv of player.survivors.filter((s) => s.alive)) {
    const slots = getMaxSlots(sv);
    const items = sv.equippedItems
      .map((item) => {
        if (!item) return null;
        if (item.kind === 'weapon') return item.weaponId.replace(/_/g, ' ');
        if (item.kind === 'equipment') return item.equipmentId.replace(/_/g, ' ');
        if (item.kind === 'resource') return `${item.amount}x ${item.resource}`;
        return null;
      })
      .filter(Boolean);
    const itemStr = items.length > 0 ? items.join(', ') : 'empty';
    const free = slots - items.length;
    console.log(`    ${sv.name.padEnd(12)} HP:${sv.hp}/${sv.maxHp}  THR:${sv.baseThreat}  Items: ${itemStr}  (${free}/${slots} free)`);
  }
}

async function askAction(state: GameState, player: PlayerState, committedCosts: Partial<Record<ResourceType, number>> = {}): Promise<SurvivorAction> {
  while (true) {
    const input = (await ask('  > ')).trim().toLowerCase();

    if (input === 'd') return { type: 'defend' };
    if (input === 'r') return { type: 'rest' };

    if (input.startsWith('s')) {
      const loc = await pickLocation(state);
      if (loc) return { type: 'scavenge', locationId: loc };
      continue;
    }

    if (input.startsWith('a')) {
      const target = await pickAttackTarget(state, player.id);
      if (target) return { type: 'attack', targetPlayerId: target };
      continue;
    }

    if (input === 'c') {
      const itemId = await pickCraftItem(player, committedCosts);
      if (itemId) return { type: 'craft', itemId };
      continue;
    }

    if (input === 'j') {
      const target = await pickAttackTarget(state, player.id);
      if (target) return { type: 'jam', targetPlayerId: target };
      continue;
    }

    if (input === 't') return { type: 'trade' };

    printError('Invalid input. Use: s, a, d, r, c, t, j');
  }
}

async function pickLocation(state: GameState): Promise<LocationId | null> {
  console.log('  Choose location:');
  state.locations.forEach((loc, i) => {
    const cards = loc.lootDeck.length;
    const status = cards === 0 ? '  [DEPLETED]' : `  (${cards} cards)`;
    console.log(`    [${i}] ${loc.name}${status}`);
  });
  const input = (await ask('    > ')).trim();
  const idx = parseInt(input, 10);
  if (idx >= 0 && idx < state.locations.length) {
    if (state.locations[idx].lootDeck.length === 0) {
      printError(`${state.locations[idx].name} is depleted — choose another location.`);
      return null;
    }
    return state.locations[idx].id;
  }
  printError('Invalid location index.');
  return null;
}

async function pickCraftItem(player: PlayerState, committedCosts: Partial<Record<ResourceType, number>> = {}): Promise<ItemId | null> {
  const craftables = allCraftables();
  const res = player.compound.resources;
  const effRes = (r: ResourceType) => Math.max(0, (res[r] ?? 0) - (committedCosts[r] ?? 0));

  console.log('  Craftable items:');
  craftables.forEach((entry, i) => {
    const cost = entry.def.craftCost ?? {};
    const costStr = Object.entries(cost).map(([r, n]) => `${n} ${r}`).join(', ') || 'free';
    const canAfford = Object.entries(cost).every(([r, n]) => effRes(r as ResourceType) >= (n as number));
    const kindLabel = entry.kind === 'weapon' ? 'WPN' : entry.kind === 'equipment' ? 'EQP' : 'STR';
    const affordStr = canAfford ? '' : '  [can\'t afford]';
    const effectStr = 'effect' in entry.def && entry.def.effect ? `  — ${entry.def.effect}` : '';
    console.log(`    [${i}] ${entry.def.name} (${kindLabel})  Cost: ${costStr}${effectStr}${affordStr}`);
  });
  console.log(`    Your resources — Wood: ${effRes('wood')}  Metal: ${effRes('metal')}  Food: ${effRes('food')}  Water: ${effRes('water')}`);

  const input = (await ask('    Pick item index (or enter to cancel) > ')).trim();
  if (input === '') return null;
  const idx = parseInt(input, 10);
  if (isNaN(idx) || idx < 0 || idx >= craftables.length) {
    printError('Invalid index.');
    return null;
  }
  return craftables[idx].def.id as ItemId;
}

async function pickAttackTarget(state: GameState, selfId: string): Promise<string | null> {
  const targets = state.players.filter((p) => p.id !== selfId && !p.isEliminated);
  if (targets.length === 0) {
    printError('No valid attack targets.');
    return null;
  }
  console.log('  Choose attack target:');
  targets.forEach((p, i) => console.log(`    [${i}] ${p.name}`));
  const input = (await ask('    > ')).trim();
  const idx = parseInt(input, 10);
  if (idx >= 0 && idx < targets.length) return targets[idx].id;
  printError('Invalid target index.');
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANNING
// ─────────────────────────────────────────────────────────────────────────────

export async function promptPlanning(engine: GameEngine, player: PlayerState): Promise<void> {
  const getPlayer = () => (engine.getState() as GameState).players.find((p) => p.id === player.id)!;
  let freshPlayer = getPlayer();
  const survivors = freshPlayer.survivors.filter((sv) => sv.alive);

  let food = freshPlayer.compound.resources.food;
  let water = freshPlayer.compound.resources.water;
  const sustenance: Record<string, SustenanceChoice> = {};

  console.log(`\n  ── Planning: ${freshPlayer.name} ──`);
  console.log(`  Food: ${food}  Water: ${water}`);
  console.log('  Food → wellFed (+1 THR, enables rest-heal). Water → prevents starvation. None → -1 HP.\n');

  for (const sv of survivors) {
    const debuffStr = sv.debuffs.length > 0 ? `  ⚠ ${sv.debuffs.join(', ')}` : '';
    console.log(`  ${sv.name} (HP:${sv.hp}/${sv.maxHp} THR:${sv.baseThreat})${debuffStr}`);
    console.log(`    Food: ${food}  Water: ${water}`);
    console.log('    [f] Feed food  [w] Give water  [n] Nothing');

    while (true) {
      const input = (await ask('  > ')).trim().toLowerCase();
      if (input === 'f') {
        if (food <= 0) { printError('No food left.'); continue; }
        sustenance[sv.id] = 'food';
        food--;
        break;
      }
      if (input === 'w') {
        if (water <= 0) { printError('No water left.'); continue; }
        sustenance[sv.id] = 'water';
        water--;
        break;
      }
      if (input === 'n') {
        sustenance[sv.id] = 'none';
        break;
      }
      printError('Use f, w, or n.');
    }
  }

  engine.submitPlanning(freshPlayer.id, { sustenance } as PlanningAllocations);

  // Equipment management — happens after sustenance is submitted so wellFed is visible
  freshPlayer = getPlayer();
  await promptInventoryManagement(engine, freshPlayer);
}

// ─────────────────────────────────────────────────────────────────────────────
// UPKEEP ALLOCATION
// ─────────────────────────────────────────────────────────────────────────────

export async function promptUpkeepAllocation(engine: GameEngine, player: PlayerState): Promise<void> {
  const state = engine.getState() as GameState;
  const freshPlayer = state.players.find((p) => p.id === player.id)!;
  const survivors = freshPlayer.survivors.filter((s) => s.alive);
  let meds = freshPlayer.compound.resources.meds;

  const medHeals: string[] = [];
  if (meds > 0) {
    const injured = survivors.filter((sv) => sv.hp < sv.maxHp);
    if (injured.length > 0) {
      console.log(`\n  ── Upkeep: ${freshPlayer.name} ──`);
      console.log(`  Meds available: ${meds}. Heal injured survivors? (+1 HP each)`);
      for (const sv of injured) {
        if (meds <= 0) break;
        console.log(`    ${sv.name} (HP:${sv.hp}/${sv.maxHp})  [y] Heal  [n] Skip`);
        while (true) {
          const input = (await ask('  > ')).trim().toLowerCase();
          if (input === 'y') { medHeals.push(sv.id); meds--; break; }
          if (input === 'n') break;
          printError('Use y or n.');
        }
      }
    }
  }

  engine.submitUpkeepAllocation(freshPlayer.id, { medHeals });
}

// ─────────────────────────────────────────────────────────────────────────────
// LOOT CLAIMING
// ─────────────────────────────────────────────────────────────────────────────

export async function promptLootClaim(engine: GameEngine, player: PlayerState): Promise<void> {
  const opp = engine.getPendingLootForPlayer(player.id);
  if (!opp) return;

  renderLootOpportunity(opp);
  console.log(`  Enter indices to take (comma-separated), e.g. "0,2". Resources are free; items limited to ${opp.carryCapacity} slot(s):`);

  while (true) {
    const input = (await ask('  > ')).trim();
    const indices = input === ''
      ? []
      : input
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n >= 0 && n < opp.revealedTokens.length);

    const itemCount = indices.filter((idx) => {
      const t = opp.revealedTokens[idx];
      return t && t.kind !== 'resource' && t.kind !== 'nothing';
    }).length;

    if (itemCount > opp.carryCapacity) {
      printError(`Too many weapons/equipment — only ${opp.carryCapacity} item slot(s) available.`);
      continue;
    }

    engine.claimLoot(opp.id, indices);
    return;
  }
}
