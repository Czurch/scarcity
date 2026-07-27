import { useEffect, useMemo, useState } from 'react';
import type { CraftRecap, GameState, PendingConflict } from '@game/types';
import type { UseGameConnection } from '../hooks/useGameConnection';
import { getItemArt } from '../data/itemArt';
import { tokenArt, tokenLabel } from '../data/lootTokens';
import { CRAFTABLE_DEFS } from '../data/craftables';

interface Props {
  state: GameState;
  myPlayerId: string;
  conn: UseGameConnection;
  conflicts: PendingConflict[];
  crafts: CraftRecap[];
  onActiveSurvivorsChange: (survivorIds: string[]) => void;
  onDone: () => void;
}

type Step = { kind: 'craft'; craft: CraftRecap } | { kind: 'conflict'; conflict: PendingConflict };

const STEP_DURATION_MS = 5000;
const REVIEW_SECONDS = 20;

function playerName(state: GameState, playerId: string, myPlayerId: string): string {
  if (playerId === myPlayerId) return 'You';
  return state.players.find((p) => p.id === playerId)?.name ?? playerId;
}

function survivorName(state: GameState, survivorId: string): string {
  for (const p of state.players) {
    const sv = p.survivors.find((s) => s.id === survivorId);
    if (sv) return sv.name;
  }
  return survivorId;
}

function targetLabel(state: GameState, conflict: PendingConflict, myPlayerId: string): string {
  const target = conflict.target;
  if (target.kind === 'location') {
    return state.locations.find((l) => l.id === target.locationId)?.name ?? target.locationId;
  }
  return `${playerName(state, target.defenderId, myPlayerId)}'s Compound`;
}

function activeSurvivorsFor(step: Step): string[] {
  if (step.kind === 'craft') {
    const ids = [step.craft.survivorId];
    if (step.craft.equippedToSurvivorId) ids.push(step.craft.equippedToSurvivorId);
    return ids;
  }
  return step.conflict.squads.flatMap((sq) => sq.survivorIds);
}

function CraftStep({ craft, state, myPlayerId }: { craft: CraftRecap; state: GameState; myPlayerId: string }) {
  const def = CRAFTABLE_DEFS.find((d) => d.id === craft.itemId);
  const art = getItemArt(craft.itemId);
  const name = def?.name ?? craft.itemId;
  const crafter = survivorName(state, craft.survivorId);
  const who = playerName(state, craft.playerId, myPlayerId);

  let line: string;
  if (craft.outcome === 'built') line = `${who} builds ${name}!`;
  else if (craft.outcome === 'equipped') {
    line = craft.equippedToSurvivorId
      ? `${crafter} crafts ${name} → equipped to ${survivorName(state, craft.equippedToSurvivorId)}`
      : `${crafter} crafts ${name} → equipped`;
  } else if (craft.outcome === 'stored') line = `${crafter} crafts ${name} — stored in compound (no free slot)`;
  else line = `${crafter} tries to craft ${name} — ${craft.reason ?? 'failed'}`;

  return (
    <div className="reveal-step">
      <div className="reveal-step-icon">
        {art ? <img src={art} alt={name} /> : <span className="fallback-label">{name}</span>}
      </div>
      <div className="reveal-step-text">{line}</div>
    </div>
  );
}

function ConflictStep({ conflict, state, myPlayerId }: { conflict: PendingConflict; state: GameState; myPlayerId: string }) {
  const label = targetLabel(state, conflict, myPlayerId);
  const contested = conflict.squads.length > 1;
  const depleted = !conflict.winnerId && conflict.lootOpportunityIds.length === 0;
  const lootOpps = conflict.lootOpportunityIds
    .map((id) => state.lootOpportunities.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => !!o);

  return (
    <div className="reveal-step">
      <div className="reveal-step-text">
        {depleted && <div>{label} is depleted — no loot available.</div>}
        {!depleted && !contested && <div>{playerName(state, conflict.squads[0].playerId, myPlayerId)} scavenges {label} — uncontested</div>}
        {!depleted && contested && (
          <>
            <div className="reveal-conflict-title">CONFLICT at {label}</div>
            <div className="reveal-squad-row">
              {conflict.squads.map((sq) => (
                <span key={sq.playerId} className={`reveal-squad${sq.playerId === conflict.winnerId ? ' winner' : ''}`}>
                  {playerName(state, sq.playerId, myPlayerId)} (THR {sq.totalThreat})
                </span>
              ))}
            </div>
            {conflict.tieBreaks > 0 && <div className="reveal-tiebreak">Tied — broken by dice roll{conflict.tieBreaks > 1 ? ` ×${conflict.tieBreaks}` : ''}!</div>}
            <div className="reveal-winner">{playerName(state, conflict.winnerId!, myPlayerId)} wins!</div>
          </>
        )}
      </div>
      {lootOpps.length > 0 && (
        <div className="reveal-loot-row">
          {lootOpps.flatMap((opp) =>
            opp.revealedTokens.map((token, i) => (
              <div key={`${opp.id}-${i}`} className="reveal-loot-token" title={tokenLabel(token)}>
                {tokenArt(token) ? <img src={tokenArt(token)!} alt={tokenLabel(token)} /> : <span className="fallback-label">{tokenLabel(token)}</span>}
              </div>
            )),
          )}
        </div>
      )}
    </div>
  );
}

export function ResolutionReveal({ state, myPlayerId, conn, conflicts, crafts, onActiveSurvivorsChange, onDone }: Props) {
  const steps: Step[] = useMemo(
    () => [
      ...crafts.map((craft): Step => ({ kind: 'craft', craft })),
      ...conflicts.map((conflict): Step => ({ kind: 'conflict', conflict })),
    ],
    [crafts, conflicts],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState<'stepping' | 'reviewing'>('stepping');
  const [reviewSecondsLeft, setReviewSecondsLeft] = useState(REVIEW_SECONDS);
  const [confirmedReady, setConfirmedReady] = useState(false);

  const step = steps[stepIndex];

  const requiredReviewerIds = state.players.filter((p) => p.isHuman && !p.isEliminated).map((p) => p.id);
  const readyCount = requiredReviewerIds.filter((id) => state.reviewReadyPlayerIds.includes(id)).length;

  useEffect(() => {
    onActiveSurvivorsChange(step ? activeSurvivorsFor(step) : []);
    return () => onActiveSurvivorsChange([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Auto-advance through the step list (paused while the user is manually navigating or reviewing).
  useEffect(() => {
    if (paused || mode !== 'stepping') return;
    const timer = setTimeout(() => {
      if (stepIndex + 1 < steps.length) setStepIndex((i) => i + 1);
      else setMode('reviewing');
    }, STEP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [stepIndex, paused, mode, steps.length]);

  const confirmReady = () => {
    if (confirmedReady) return;
    setConfirmedReady(true);
    conn.send({ type: 'review_ready_request', gameId: conn.gameId!, playerId: myPlayerId });
    onDone();
  };

  // Final review window: up to REVIEW_SECONDS to look back over anything before auto-continuing.
  useEffect(() => {
    if (mode !== 'reviewing' || confirmedReady) return;
    if (reviewSecondsLeft <= 0) {
      confirmReady();
      return;
    }
    const timer = setTimeout(() => setReviewSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reviewSecondsLeft, confirmedReady]);

  if (steps.length === 0 || !step) return null;

  function goPrev() {
    setPaused(true);
    setMode('stepping');
    setStepIndex((i) => Math.max(0, i - 1));
  }

  function goNext() {
    setPaused(true);
    if (stepIndex + 1 < steps.length) setStepIndex((i) => i + 1);
    else setMode('reviewing');
  }

  return (
    <div className="reveal-backdrop">
      <div className="reveal-modal">
        <div className="reveal-header">
          <span className="reveal-progress">
            {mode === 'stepping' ? `Step ${stepIndex + 1}/${steps.length}` : 'Review complete'}
          </span>
          <div className="reveal-controls">
            {mode === 'stepping' && (
              <button type="button" className="reveal-control-btn" onClick={() => setPaused((p) => !p)}>
                {paused ? '▶ Play' : '⏸ Pause'}
              </button>
            )}
            <button type="button" className="reveal-control-btn" onClick={goPrev} disabled={stepIndex === 0 && mode === 'stepping'}>◀ Prev</button>
            <button type="button" className="reveal-control-btn" onClick={goNext} disabled={mode === 'reviewing'}>Next ▶</button>
            <button type="button" className="reveal-control-btn" onClick={onDone}>Skip</button>
          </div>
        </div>
        <div className="reveal-body">
          {step.kind === 'craft' ? (
            <CraftStep craft={step.craft} state={state} myPlayerId={myPlayerId} />
          ) : (
            <ConflictStep conflict={step.conflict} state={state} myPlayerId={myPlayerId} />
          )}
        </div>
        {mode === 'reviewing' && (
          <div className="reveal-review-bar">
            <span>
              Take your time — continuing in {reviewSecondsLeft}s
              {requiredReviewerIds.length > 1 && ` (${readyCount}/${requiredReviewerIds.length} ready)`}
            </span>
            <button type="button" className="reveal-ready-btn" onClick={confirmReady} disabled={confirmedReady}>
              {confirmedReady ? 'Ready ✓' : "I'm Ready"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
