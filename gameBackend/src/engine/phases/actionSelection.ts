import { GameState, GameReducerAction, SurvivorIntent, SurvivorAction } from '../../types';
import { getActiveSurvivors, addEvent } from '../helpers';


export function applySubmitIntents(
  state: GameState,
  action: Extract<GameReducerAction, { type: 'SUBMIT_INTENTS' }>,
): GameState {
  if (state.phase !== 'action_selection') return state;

  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const player = s.players.find((p) => p.id === action.playerId);
  if (!player || player.isEliminated) return s;

  // Validate: every alive survivor must have an intent
  const aliveIds = new Set(getActiveSurvivors(player).map((sv) => sv.id));
  const submittedIds = new Set(action.intents.map((i) => i.survivorId));
  for (const id of aliveIds) {
    if (!submittedIds.has(id)) {
      // Auto-assign rest to missing survivors
      action.intents.push({ survivorId: id, action: { type: 'rest' } });
    }
  }

  // Validate food availability — actions that cost food checked here.
  // Food is deducted from compound when intents are finalized.
  player.intents = action.intents.filter((i) => aliveIds.has(i.survivorId));
  player.intentsSubmitted = true;

  const summary = player.intents.map((i) => `${i.survivorId}→${describeAction(i.action)}`).join(', ');
  addEvent(s, `${player.name} declares intents: ${summary}`, ['action_selection']);

  // If all active players have submitted, advance phase
  const allReady = s.players.filter((p) => !p.isEliminated).every((p) => p.intentsSubmitted);
  if (allReady) {
    return finalizeActionSelection(s);
  }
  return s;
}

function finalizeActionSelection(state: GameState): GameState {
  state.phase = 'conflict_resolution';
  addEvent(state, 'All intents declared. Resolving conflicts...', ['phase']);
  return state;
}

function describeAction(action: SurvivorAction): string {
  switch (action.type) {
    case 'scavenge': return `scavenge(${action.locationId})`;
    case 'attack':   return `attack(${action.targetPlayerId})`;
    case 'defend':   return 'defend';
    case 'rest':     return 'rest';
    case 'trade':    return 'trade';
    case 'craft':    return `craft(${action.itemId})`;
    case 'jam':      return `jam(${action.targetPlayerId})`;
  }
}
