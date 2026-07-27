import { GameEngine } from '../GameEngine';
import { createInitialState, gameReducer } from '../engine/reducer';
import { GameConfig, GameReducerAction, GameState, SurvivorState, ResourceType, PlanningAllocations, SustenanceChoice } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const BASE_CONFIG: GameConfig = {
  playerCount: 2,
  playerNames: ['Alpha', 'Beta'],
  humanPlayerIndices: [],
  startingResources: { water: 8, food: 6, meds: 0, wood: 0, metal: 0, ammo: 0 },
  locationLootConfigs: {},
  seed: 1,
};

/**
 * Build a game state already in action_selection with fully custom survivors,
 * bypassing the draft. Each player gets the same resource pool unless overridden.
 * This lets us test specific mechanics without depending on random draft outcomes.
 */
function makeTestState(
  p0Survivors: Array<{ hp: number; threat: number }>,
  p1Survivors: Array<{ hp: number; threat: number }>,
  resources: Partial<Record<ResourceType, number>> = {},
): GameState {
  const state = createInitialState({ ...BASE_CONFIG, seed: 1 });
  state.phase = 'action_selection';
  state.draftPool = [];

  const makeSurvivor = (playerId: string, i: number, spec: { hp: number; threat: number }): SurvivorState => ({
    id: `${playerId}_s${i}`,
    templateId: 'test',
    name: `Survivor ${i + 1}`,
    hp: spec.hp,
    maxHp: spec.hp,
    baseThreat: spec.threat,
    equippedItems: [null, null],
    debuffs: [],
    alive: true,
  });

  state.players[0].survivors = p0Survivors.map((s, i) => makeSurvivor('player_0', i, s));
  state.players[1].survivors = p1Survivors.map((s, i) => makeSurvivor('player_1', i, s));

  const merged = { water: 8, food: 6, meds: 0, wood: 0, metal: 0, ammo: 0, ...resources };
  state.players[0].compound.resources = { ...merged };
  state.players[1].compound.resources = { ...merged };

  // Simulate planning already completed: greedily allocate food then water, set wellFed.
  for (const player of state.players) {
    const sustenance: Record<string, SustenanceChoice> = {};
    let food = player.compound.resources.food;
    let water = player.compound.resources.water;
    for (const sv of player.survivors.filter((s) => s.alive)) {
      if (food > 0) { sustenance[sv.id] = 'food'; food--; sv.wellFed = true; }
      else if (water > 0) { sustenance[sv.id] = 'water'; water--; }
      else { sustenance[sv.id] = 'none'; }
    }
    state.planningAllocations[player.id] = { sustenance };
  }

  return state;
}

/** Feed a sequence of actions through the reducer. Returns the final state. */
function run(state: GameState, actions: GameReducerAction[]): GameState {
  return actions.reduce((s, a) => gameReducer(s, a), state);
}

// Shorthand for auto-advancing a phase transition
const ADVANCE = { type: 'AUTO_ADVANCE' } as const;

// ─────────────────────────────────────────────────────────────────────────────
// DRAFT PHASE
// ─────────────────────────────────────────────────────────────────────────────

describe('Draft Phase', () => {
  test('draft pool starts at 5 × player count', () => {
    const engine = new GameEngine({ ...BASE_CONFIG, playerCount: 3, playerNames: ['A', 'B', 'C'] });
    expect(engine.getState().draftPool).toHaveLength(15);
  });

  test('each player ends up with 4 survivors after the draft', () => {
    const engine = new GameEngine(BASE_CONFIG);
    engine.autoAdvance(); // AI completes entire draft
    const { players } = engine.getState();
    for (const player of players) {
      expect(player.survivors).toHaveLength(4);
    }
  });

  test('picked survivors are removed from the draft pool', () => {
    const engine = new GameEngine({ ...BASE_CONFIG, humanPlayerIndices: [0] });
    const pool = engine.getState().draftPool;
    const pick = pool[0];
    engine.draftPick(engine.getCurrentDrafter()!.id, pick.id);
    expect(engine.getState().draftPool.find((s) => s.id === pick.id)).toBeUndefined();
  });

  test('game moves to action_selection once all picks are complete', () => {
    // With a human player, autoAdvance() halts when waiting for human input,
    // letting us observe the state after the draft without the game running on.
    const engine = new GameEngine({ ...BASE_CONFIG, humanPlayerIndices: [0] });
    expect(engine.getState().phase).toBe('draft');
    while (engine.getState().phase === 'draft') {
      engine.autoAdvance();                                     // advance AI turns
      if (engine.isWaitingForHuman()) {                         // human's draft turn
        const drafter = engine.getCurrentDrafter()!;
        engine.draftPick(drafter.id, engine.getDraftPool()[0].id);
      }
    }
    // Draft is done; now waiting for the human to submit planning
    expect(engine.getState().phase).toBe('planning');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOOD MECHANIC
// ─────────────────────────────────────────────────────────────────────────────

describe('Food Mechanic', () => {
  test('1 food is consumed per survivor at upkeep', () => {
    const state = makeTestState(
      [{ hp: 3, threat: 2 }, { hp: 3, threat: 2 }], // 2 survivors
      [{ hp: 3, threat: 2 }],
      { food: 10 },
    );
    const foodBefore = state.players[0].compound.resources.food;

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'rest' } },
        { survivorId: 'player_0_s1', action: { type: 'rest' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE, ADVANCE, ADVANCE, // conflict → looting → upkeep → action_selection
    ]);

    expect(after.players[0].compound.resources.food).toBe(foodBefore - 2);
  });

  test('a survivor without food becomes starving and takes 1 HP damage', () => {
    const state = makeTestState([{ hp: 3, threat: 2 }], [{ hp: 3, threat: 2 }], { food: 0, water: 0 });

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'rest' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE, ADVANCE, ADVANCE,
    ]);

    const sv = after.players[0].survivors[0];
    expect(sv.debuffs).toContain('starving');
    expect(sv.hp).toBe(2); // 3 − 1
  });

  test('a well-fed survivor gets +1 threat', () => {
    // Planning phase pre-sets wellFed based on food allocation
    const state = makeTestState([{ hp: 3, threat: 2 }], [{ hp: 3, threat: 2 }], { food: 6 });
    // makeTestState simulates planning completion: survivor_0 gets food → wellFed = true
    expect(state.players[0].survivors[0].wellFed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFLICT RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Conflict Resolution', () => {
  test('the higher-threat survivor wins a contested location', () => {
    // THR:4 vs THR:1 — no tie possible, outcome is deterministic
    const state = makeTestState([{ hp: 3, threat: 4 }], [{ hp: 3, threat: 1 }]);

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      ADVANCE, // conflict_resolution → looting
    ]);

    // The loser (lower threat) takes 1 HP damage
    expect(after.players[1].survivors[0].hp).toBe(2); // 3 − 1
    // The winner gets a loot opportunity
    expect(after.lootOpportunities.some((o) => o.playerId === 'player_0')).toBe(true);
  });

  test('conflict damage is always 1 HP regardless of threat difference', () => {
    // Even a massive threat gap only deals 1 damage
    const state = makeTestState([{ hp: 3, threat: 5 }], [{ hp: 3, threat: 1 }]);

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      ADVANCE,
    ]);

    expect(after.players[1].survivors[0].hp).toBe(after.players[1].survivors[0].maxHp - 1);
  });

  test('an uncontested location gives the scavenger a loot opportunity', () => {
    const state = makeTestState([{ hp: 3, threat: 2 }], [{ hp: 3, threat: 2 }]);

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } }, // stays home
      ]},
      ADVANCE,
    ]);

    expect(after.lootOpportunities).toHaveLength(1);
    expect(after.lootOpportunities[0].playerId).toBe('player_0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOOTING
// ─────────────────────────────────────────────────────────────────────────────

describe('Looting', () => {
  test('N survivors sent → N+2 cards revealed; carryCapacity = total free item slots', () => {
    // Send 2 survivors (each with 2 empty item slots) to an uncontested location
    const state = makeTestState(
      [{ hp: 3, threat: 2 }, { hp: 3, threat: 2 }],
      [{ hp: 3, threat: 2 }],
    );

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
        { survivorId: 'player_0_s1', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE,
    ]);

    const opp = after.lootOpportunities[0];
    expect(opp.revealedTokens).toHaveLength(4); // N+2 = 2+2
    expect(opp.carryCapacity).toBe(4);          // 2 survivors × 2 empty slots each
  });

  test('an equipped flashlight reveals 1 extra card without reducing carry capacity', () => {
    const state = makeTestState(
      [{ hp: 3, threat: 2 }],
      [{ hp: 3, threat: 2 }],
    );
    state.players[0].survivors[0].equippedItems = [
      { kind: 'equipment', equipmentId: 'flashlight' },
      null,
    ];

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE,
    ]);

    const opp = after.lootOpportunities[0];
    expect(opp.revealedTokens).toHaveLength(4); // N+2+flashlight = 1+2+1
    expect(opp.carryCapacity).toBe(2);          // flashlight occupies a slot but grants it back (net 0)
  });

  test('scavenging a depleted location yields no loot opportunity', () => {
    const state = makeTestState([{ hp: 3, threat: 2 }], [{ hp: 3, threat: 2 }]);
    // Empty the reservoir
    state.locations.find((l) => l.id === 'reservoir')!.lootDeck = [];

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE,
    ]);

    expect(after.lootOpportunities).toHaveLength(0);
  });

  test('looted resources arrive in the player compound', () => {
    const state = makeTestState([{ hp: 3, threat: 2 }], [{ hp: 3, threat: 2 }]);
    const waterBefore = state.players[0].compound.resources.water;

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'scavenge', locationId: 'reservoir' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE, // conflict → looting
      ADVANCE, // looting → upkeep (auto-claims; reservoir is water-only, all revealed tokens taken)
      ADVANCE, // upkeep → action_selection (water consumed here)
    ]);

    // 1 survivor → reveals 3 tokens; with seed 1, reservoir deck is [water, water, nothing, ...]
    // so 2 water tokens are taken. Upkeep consumes food (not water). Net: +2
    expect(after.players[0].compound.resources.water).toBe(waterBefore + 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPKEEP & SUSTENANCE
// ─────────────────────────────────────────────────────────────────────────────

describe('Upkeep & Sustenance', () => {
  test('food is consumed first; water is the fallback', () => {
    // 2 survivors, food: 1 — one eats food (wellFed), one drinks water
    const state = makeTestState(
      [{ hp: 3, threat: 2 }, { hp: 3, threat: 2 }],
      [{ hp: 3, threat: 2 }],
      { food: 1, water: 10 },
    );

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'rest' } },
        { survivorId: 'player_0_s1', action: { type: 'rest' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE, ADVANCE, ADVANCE,
    ]);

    expect(after.players[0].compound.resources.food).toBe(0);  // 1 food consumed
    expect(after.players[0].compound.resources.water).toBe(9); // 1 water consumed as fallback
  });

  test('a survivor with no food or water becomes starving and takes 1 HP damage', () => {
    const state = makeTestState([{ hp: 3, threat: 2 }], [{ hp: 3, threat: 2 }], { food: 0, water: 0 });

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'rest' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE, ADVANCE, ADVANCE,
    ]);

    const sv = after.players[0].survivors[0];
    expect(sv.debuffs).toContain('starving');
    expect(sv.hp).toBe(2); // 3 − 1
  });

  test('a survivor at 0 HP is marked dead', () => {
    // 1 HP + no food or water = dies at upkeep
    const state = makeTestState([{ hp: 1, threat: 2 }], [{ hp: 3, threat: 2 }], { food: 0, water: 0 });

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'rest' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE, ADVANCE, ADVANCE,
    ]);

    const dead = after.players[0].survivors[0];
    expect(dead.alive).toBe(false);
    expect(dead.hp).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ELIMINATION & WIN CONDITION
// ─────────────────────────────────────────────────────────────────────────────

describe('Elimination & Win Condition', () => {
  test('a player is eliminated when all their survivors die', () => {
    const state = makeTestState([{ hp: 1, threat: 2 }], [{ hp: 3, threat: 2 }], { food: 0, water: 0 });

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'rest' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE, ADVANCE, ADVANCE,
    ]);

    expect(after.players[0].isEliminated).toBe(true);
  });

  test('the game ends when only one player has living survivors', () => {
    const state = makeTestState([{ hp: 1, threat: 2 }], [{ hp: 3, threat: 2 }], { food: 0, water: 0 });

    const after = run(state, [
      { type: 'SUBMIT_INTENTS', playerId: 'player_0', intents: [
        { survivorId: 'player_0_s0', action: { type: 'rest' } },
      ]},
      { type: 'SUBMIT_INTENTS', playerId: 'player_1', intents: [
        { survivorId: 'player_1_s0', action: { type: 'rest' } },
      ]},
      ADVANCE, ADVANCE, ADVANCE,
    ]);

    expect(after.phase).toBe('game_over');
    expect(after.winnerId).toBe('player_1');
  });

  test('forfeiting immediately eliminates a player', () => {
    const engine = new GameEngine(BASE_CONFIG);
    engine.autoAdvance(); // complete draft
    engine.forfeit('player_0');
    expect(engine.getState().players[0].isEliminated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Full Simulation', () => {
  test('a 4-player all-AI game completes with a single winner', () => {
    const engine = new GameEngine({
      playerCount: 4,
      playerNames: ['P1', 'P2', 'P3', 'P4'],
      humanPlayerIndices: [],
      startingResources: { water: 20, food: 16, meds: 2, wood: 4, metal: 2, ammo: 0 },
      locationLootConfigs: {},
      seed: 42,
    });

    engine.runToEnd(100);
    const state = engine.getState();

    expect(state.phase).toBe('game_over');
    expect(state.winnerId).toBeDefined();
    expect(state.round).toBeGreaterThan(1);
    expect(state.round).toBeLessThanOrEqual(100);
  });

  test('100 simulated games all complete with a defined winner', () => {
    let draws = 0;
    for (let seed = 0; seed < 100; seed++) {
      const engine = new GameEngine({
        playerCount: 3,
        playerNames: ['A', 'B', 'C'],
        humanPlayerIndices: [],
        startingResources: { water: 20, food: 16, meds: 2, wood: 4, metal: 2, ammo: 0 },
        locationLootConfigs: {},
        seed,
      });
      engine.runToEnd(150);
      if (!engine.getState().winnerId) draws++;
    }
    expect(draws).toBe(0);
  });
});
