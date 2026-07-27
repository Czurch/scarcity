import { GameState, GameReducerAction, PlanningAllocations, PlayerState, SustenanceChoice } from '../../types';
import { addEvent } from '../helpers';

export function applySubmitPlanning(
  state: GameState,
  action: Extract<GameReducerAction, { type: 'SUBMIT_PLANNING' }>,
): GameState {
  if (state.phase !== 'planning') return state;
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const player = s.players.find((p) => p.id === action.playerId);
  if (!player || player.isEliminated) return s;

  s.planningAllocations[action.playerId] = action.allocations;
  applyWellFed(player, action.allocations);

  return tryAdvanceToActionSelection(s);
}

export function autoAdvancePlanning(state: GameState): GameState {
  let s = JSON.parse(JSON.stringify(state)) as GameState;

  for (const player of s.players) {
    if (s.planningAllocations[player.id]) continue;
    if (player.isEliminated || (!player.isHuman && !player.isAgent)) {
      const alloc = autoAllocate(player);
      s.planningAllocations[player.id] = alloc;
      applyWellFed(player, alloc);
    }
  }

  return tryAdvanceToActionSelection(s);
}

function applyWellFed(player: PlayerState, alloc: PlanningAllocations): void {
  for (const sv of player.survivors.filter((sv) => sv.alive)) {
    sv.wellFed = alloc.sustenance[sv.id] === 'food';
  }
}

function autoAllocate(player: PlayerState): PlanningAllocations {
  const sustenance: Record<string, SustenanceChoice> = {};
  let food = player.compound.resources.food;
  let water = player.compound.resources.water;

  for (const sv of player.survivors.filter((sv) => sv.alive)) {
    if (food > 0) {
      sustenance[sv.id] = 'food';
      food--;
    } else if (water > 0) {
      sustenance[sv.id] = 'water';
      water--;
    } else {
      sustenance[sv.id] = 'none';
    }
  }
  return { sustenance };
}

function tryAdvanceToActionSelection(state: GameState): GameState {
  const pending = state.players.filter(
    (p) => !p.isEliminated && !state.planningAllocations[p.id],
  );
  if (pending.length > 0) return state;
  state.phase = 'action_selection';
  addEvent(state, 'Planning complete. Action selection begins...', ['phase']);
  return state;
}
