# Change Propagation Guide

When the game rules change in `gameBackend/`, other parts of the system may need updates.
This document maps each change type to what breaks and what needs updating.

---

## The Core Problem: The Encoder is a Hardcoded Contract

`rlAgent/agent/encoder.py` converts `GameState` into a **fixed 813-dimensional tensor**.
The size is computed from constants at the top of the file:

```python
RESOURCE_TYPES = ["water", "food", "meds", "wood", "metal", "ammo"]   # 6
WEAPON_IDS     = ["wooden_club", "lead_pipe", ...]                     # 5
EQUIPMENT_IDS  = ["backpack", "hand_cart", "armor", "radio", "jammer", "flashlight"] # 6
STRUCTURE_IDS  = ["bunk", "spike_trap", ...]                           # 7
LOCATION_IDS   = ["mini_mart", "police_station", ...]                  # 9
PHASES         = ["draft", "action_selection", ...]                    # 6
```

Any change to these lists changes `OBS_SIZE`, which changes the model's input dimension.
**A trained model checkpoint is incompatible with a different OBS_SIZE.**
This means adding a new resource type or location invalidates all existing checkpoints.

The model's action space is also fixed in `agent/model.py`:
```python
N_SURVIVOR_ACTIONS = 2 + len(LOCATION_IDS) + MAX_PLAYERS  # 15
```

---

## Change Checklist by Type

### Adding a new Resource type

- [ ] `gameBackend/src/types.ts` — add to `ResourceType` union
- [ ] `gameBackend/src/data/locations.ts` — add to relevant loot decks
- [ ] `gameBackend/src/engine/ai.ts` — add to `LOCATION_RESOURCES` map
- [ ] `rlAgent/agent/encoder.py` — add to `RESOURCE_TYPES` list
- [ ] **OBS_SIZE changes → existing checkpoints are invalid**

### Adding a new Location

- [ ] `gameBackend/src/types.ts` — add to `LocationId` union
- [ ] `gameBackend/src/data/locations.ts` — define loot deck
- [ ] `gameBackend/src/engine/ai.ts` — add to `LOCATION_RESOURCES` map
- [ ] `rlAgent/agent/encoder.py` — add to `LOCATION_IDS` list
- [ ] `rlAgent/agent/model.py` — `N_SURVIVOR_ACTIONS` increases (more scavenge targets)
- [ ] `rlAgent/agent/decoder.py` — action index mapping shifts; verify `ACT_SCAV_START/END`
- [ ] **OBS_SIZE changes → existing checkpoints are invalid**

### Adding a new Survivor Action type

- [ ] `gameBackend/src/types.ts` — add to `SurvivorAction` union
- [ ] `gameBackend/src/engine/phases/actionSelection.ts` — handle new action
- [ ] `gameBackend/src/engine/phases/conflictResolution.ts` — handle if applicable
- [ ] `rlAgent/agent/model.py` — increment `N_SURVIVOR_ACTIONS`
- [ ] `rlAgent/agent/decoder.py` — add new action index mapping
- [ ] `rlAgent/training/ppo.py` — update `_survivor_action_mask` if action has validity conditions
- [ ] **Model action head output size changes → existing checkpoints are invalid**

### Adding a new Weapon or Equipment item

- [ ] `gameBackend/src/types.ts` — add to `WeaponId` or `EquipmentId` union
- [ ] `gameBackend/src/data/` — add item definition and add to relevant loot decks
- [ ] `rlAgent/agent/encoder.py` — add to `WEAPON_IDS` or `EQUIPMENT_IDS` list
- [ ] **OBS_SIZE changes → existing checkpoints are invalid**

### Adding a new Structure

- [ ] `gameBackend/src/types.ts` — add to `StructureId` union
- [ ] `gameBackend/src/engine/phases/` — implement structure effect
- [ ] `rlAgent/agent/encoder.py` — add to `STRUCTURE_IDS` list
- [ ] **OBS_SIZE changes → existing checkpoints are invalid**

### Adding a new Game Phase

- [ ] `gameBackend/src/types.ts` — add to `GamePhase` union
- [ ] `gameBackend/src/engine/reducer.ts` — handle phase in `gameReducer` and `AUTO_ADVANCE`
- [ ] `gameBackend/src/GameEngine.ts` — add `isWaitingForAgent()` / `isWaitingForHuman()` case
- [ ] `gameBackend/src/server/session.ts` — add case to session loop
- [ ] `gameBackend/src/server/protocol.ts` — add new request/response message types
- [ ] `rlAgent/agent/encoder.py` — add to `PHASES` list
- [ ] `rlAgent/agent/model.py` — add new actor head if the phase requires a decision
- [ ] `rlAgent/train.py` — handle new message type in game loop
- [ ] `rlAgent/play_verbose.py` — handle new message type
- [ ] **OBS_SIZE changes + model architecture changes → existing checkpoints are invalid**

### Changing a Game Rule (no new types)

Examples: damage values, loot quantities, upkeep costs, win conditions.

- [ ] Edit the relevant phase file in `gameBackend/src/engine/phases/`
- [ ] Re-run `npm run sim` to validate balance impact
- [ ] Existing checkpoints remain **structurally valid** but the model's learned values are now calibrated to the old rules — effectively needs retraining

### Adding a Survivor Passive Ability

Currently stubs only. When implemented:

- [ ] `gameBackend/src/engine/phases/` — implement effect
- [ ] Consider whether the ability's state needs to be encoded (if it affects decisions)
- [ ] If encoded, add to survivor encoding in `encoder.py` → OBS_SIZE change

---

## Checkpoint Compatibility

| Change type | Checkpoints valid? |
|---|---|
| Rule tweak (no new types) | Structurally yes, but retraining recommended |
| New resource / location / item / structure | No — OBS_SIZE changes |
| New survivor action | No — model action head changes |
| New game phase with new decision | No — both OBS_SIZE and model change |
| Bug fix in encoder constants | No — tensor layout changes |

**When breaking changes are necessary:** Delete or archive old checkpoints and restart training.
There is no migration path for incompatible checkpoints.

---

## Validating After a Change

1. `cd gameBackend && npx tsc --noEmit` — TypeScript must compile clean
2. `cd rlAgent && python run_random.py` — full game must complete without errors
3. `cd rlAgent && python -c "from agent.encoder import OBS_SIZE; print(OBS_SIZE)"` — verify OBS_SIZE matches expectation
4. `cd gameBackend && npm run sim 100` — sanity check game balance hasn't broken
