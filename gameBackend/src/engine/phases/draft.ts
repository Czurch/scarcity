import { GameState, GameReducerAction, SurvivorState } from '../../types';
import { ALL_SURVIVORS } from '../../data/survivors';
import { addEvent, activePlayers } from '../helpers';
import { createRng } from '../../utils/rng';

export function applyDraftPick(state: GameState, action: Extract<GameReducerAction, { type: 'DRAFT_PICK' }>): GameState {
  if (state.phase !== 'draft') return state;

  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const { playerId, survivorId } = action;

  // Validate it's this player's turn
  const expectedPlayerId = s.draftOrder[s.currentDraftIndex % s.draftOrder.length];
  if (playerId !== expectedPlayerId) {
    addEvent(s, `It is not ${playerId}'s turn to draft.`, ['draft', 'error']);
    return s;
  }

  // Find template
  const template = s.draftPool.find((t) => t.id === survivorId);
  if (!template) {
    addEvent(s, `Survivor ${survivorId} not available in draft pool.`, ['draft', 'error']);
    return s;
  }

  // Add to player
  const player = s.players.find((p) => p.id === playerId)!;
  const newSurvivor: SurvivorState = {
    id: `${playerId}_${survivorId}`,
    templateId: template.id,
    name: template.name,
    hp: template.maxHp,
    maxHp: template.maxHp,
    baseThreat: template.baseThreat,
    equippedItems: [null, null],
    debuffs: [],
    alive: true,
  };
  player.survivors.push(newSurvivor);
  s.draftPool = s.draftPool.filter((t) => t.id !== survivorId);
  s.picksMade[playerId] = (s.picksMade[playerId] ?? 0) + 1;
  s.currentDraftIndex++;

  addEvent(s, `${player.name} drafted ${template.name} (HP:${template.maxHp} THR:${template.baseThreat})`, ['draft']);

  // Check if draft is complete
  const done = s.players.every((p) => (s.picksMade[p.id] ?? 0) >= s.picksPerPlayer);
  if (done) {
    s.phase = 'planning';
    addEvent(s, 'Draft complete. Planning begins!', ['draft', 'phase']);
  }

  return s;
}

/** Build the initial draft state (called during game init). */
export function buildDraftState(state: GameState): GameState {
  const s = JSON.parse(JSON.stringify(state)) as GameState;
  const rng = createRng(s.rngSeed + s.rngCounter++);

  const poolSize = s.players.length * 5;
  const shuffled = rng.shuffle([...ALL_SURVIVORS]);
  s.draftPool = shuffled.slice(0, poolSize);

  // Random draft order
  s.draftOrder = rng.shuffle(s.players.map((p) => p.id));
  s.currentDraftIndex = 0;
  s.picksMade = {};

  addEvent(s, `Draft begins. Order: ${s.draftOrder.map((id) => s.players.find((p) => p.id === id)!.name).join(' → ')}`, ['draft', 'phase']);
  return s;
}
