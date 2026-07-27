# Roadmap

## Current State

- [x] TypeScript game engine (pure reducer, all core mechanics)
- [x] Rule-based CPU AI (4 strategies: balanced, rusher, hoarder, raider)
- [x] Batch simulator for balance testing (`npm run sim`)
- [x] STDIN/STDOUT match server with agent seat support
- [x] Transport abstraction (`Transport` interface) for future WebSocket
- [x] Python RL pipeline: encoder, actor-critic model, PPO training
- [x] Self-play training (one Python process, all 4 seats)
- [x] Verbose game logging for pattern analysis
- [x] Human vs RL agent play (`npm run play` + `python connect_as_agent.py`)
- [x] Planning phase: pre-round sustenance allocation + equipment management before action selection
- [x] Web frontend (React + Vite) + multi-human web server (`gameBackend/src/server/room.ts`, `web-server.ts`) — friends join a lobby, claim seats, and play a full game over WebSocket; reconnect via per-seat token
- [ ] Passive abilities (stubs only — mechanics not implemented)
- [ ] Crafting (action declared but not resolved)
- [ ] Trading (stub)
- [ ] Random events

---

## Human vs RL Agent Play

**How it works:**
- `npm run play` (from gameBackend/) starts a WebSocket server and hosts the game — you play as seat 0 in the CLI
- `python connect_as_agent.py --checkpoint checkpoints/model_update_XXXX.pt` (from rlAgent/) connects as seats 1-3
- Human plays via the existing ANSI CLI (same display/prompts as `npm run start`)
- RL agents play via WebSocket using the same protocol messages as training

**Files added:**
- `src/server/transports/websocket.ts` — `WebSocketTransport` implementing the `Transport` interface
- `src/server/play-vs-rl.ts` — hybrid game loop entry point
- `rlAgent/connect_as_agent.py` — Python WebSocket client using a trained checkpoint

**Optional args:**
- `npm run play -- --port=9090 --name=YourName --seed=42`
- `python connect_as_agent.py --port 9090`

**Future:** Unity client — same WebSocket protocol, same `ServerMessage`/`AgentMessage` types.

---

## Web Frontend (Friends Playing Together)

**How it works:**
- `npm run web-server` (from gameBackend/) hosts one or more rooms over WebSocket (`--port=8080 --max-players=4`)
- `npm run dev` (from frontend/) serves the React client; each friend opens it in a browser, enters the host's address + their name, and joins the lobby
- Host declares the seat count when the room is created; friends claim seats in any order; host clicks Start once ≥2 have joined — unfilled seats become CPU
- If a connection drops, reopening the page resumes the same seat via a rejoin token stored in `localStorage`
- Hosting for friends over the internet (port-forward, ngrok, Tailscale, etc.) is the host's own responsibility — not automated

**Files added:**
- `gameBackend/src/server/webProtocol.ts` — lobby message types + human-facing additions (reuses `protocol.ts` for in-game messages)
- `gameBackend/src/server/room.ts` — `Room`: lobby/seat-claiming + event-driven multi-human game loop
- `gameBackend/src/server/web-server.ts` — entry point, `Map<roomId, Room>`
- `frontend/` — React + Vite + TS app; shares `gameBackend/src` types via a Vite path alias (`@game/*`), no monorepo restructuring

**Known gaps / next iterations:**
- Visual layout is a first functional pass based on the rough sketchup mockup (`frontend/assets/sketchup/`) — expected to need several rounds of styling iteration
- No art yet for `pipe_gun`, `rifle`, or the `wood` resource (placeholders render as text fallback in `frontend/src/data/itemArt.ts`)
- Passive abilities / crafting resolution / trading / random events have no frontend UI since the engine doesn't implement them yet (see Game Features Backlog below)

---

## Training Improvements (Backlog)

**Shaped rewards:** Currently win=+1, loss=-1/3. Intermediate rewards (e.g., relative resource advantage, survival length) would accelerate learning and help the model understand *why* it's winning, not just *that* it's winning.

**Faster training:** `ts-node` startup (~5s per game) is the main bottleneck. Pre-compiling with `tsc` and running `node dist/server/index.js` would make training significantly faster.

**Separate model instances per seat:** Currently one model plays all 4 seats (Option A). Using a pool of model snapshots (some older, some current) as opponents adds diversity to self-play and prevents policy collapse.

**Planning mask consistency:** The food/water availability mask applied during planning collection is not re-applied during PPO update (the log_prob recomputation uses the full 3-way softmax). This is a known approximation — acceptable for v1 but worth fixing.

---

## Game Features Backlog

| Feature | Notes |
|---|---|
| Passive abilities | 24 survivors have passive descriptions but no implemented mechanics |
| Crafting | Action type exists; resolution not implemented |
| Trading (underground market) | Stub |
| Random events | Not started |
| Winner damage in conflict | Config flag `winnerTakesDamage` is wired up, defaults false — flip to true when ready to test |
| Item quantity in loot decks | Currently items are unique; quantities not supported |
| Survivor XP / leveling | Not designed yet |

---

## Playtesting Notes (2026-07-01)

Notes from first human vs RL agent session. Not yet prioritized or acted on.

### Balance

**[DONE] Backpack craft cost raised**: wood 3 → 4.

**[DONE] Hand cart craft cost raised**: wood 5 → 6. Hand cart now also prevents the survivor from wielding a weapon (both hands occupied) — weapon threat bonus is suppressed in `getSurvivorThreat`; weapons won't be auto-assigned to hand_cart survivors during loot claiming.

**[DONE] Removed starting meds**: `DEFAULT_STARTING_RESOURCES` meds set to 0. Meds are now loot-only (Hospital, etc.).

**Compound raid loot should be fixed and random per attacking survivor**, not "pick from everything in the defender's compound." Current system lets a well-equipped attacker take an unbounded number of items. Fixed draw per survivor caps this naturally and removes the carry capacity interaction.

### Crafting (design direction, not yet implemented)

- Crafting resolves during conflict resolution (action phase). Crafting survivors skip defending unless an alarm triggers.
- Unique limit on powerful items/structures (1 per player) to prevent stacking.
- **Stash** — a craftable structure that protects compound resources from raid. Design options: flat chance to block looting (e.g., 30%), or safeguard a fixed number of items per raid.
- **Booby traps** — craftable, placeable at specific locations. Triggers on scavengers or raiders who target that location.

### Comeback Mechanics

Players with one survivor have very limited action options (can't meaningfully attack, easy raid target). Some options discussed:
- **Recruit survivor** action at a specific location (e.g., Hospital, or a new Refugee Camp). High-risk run to gain a survivor — natural comeback mechanic.
- World random events that create shared pressure can level the field without directly targeting leaders.
- The "pressing advantage" nature of multiple survivors is probably correct — but total shutdown of options for 1-survivor players needs attention.

### Random Events

Mix of world events (affect all players, create shared pressure) and per-player events (targeted, rarer).

Example world events: roving band of marauders attacks all compounds, virus spreads (all survivors take 1 damage), explosion knocks out a location for a round, zombie horde spawns at a location with threat X.

Example per-player events: injured survivor asks for help (spend meds to gain a favor, or ignore), a trader knocks (exchange resources), special item spawns at a specific location (race to claim it).

Architecture note: random events fit naturally in the existing phase pipeline (a new `events` phase after conflict, or as modifiers applied at round start). World events go in `state.worldEvents`; per-player events go in `state.pendingEvents[playerId]`.

---

## Architecture Principles (Don't Break These)

1. **The engine is the source of truth.** All game rules live in `gameBackend/src/engine/`. No client duplicates rule logic.

2. **The protocol is the contract.** `protocol.ts` message types define what clients can expect. Don't change message shapes without updating all clients.

3. **STDIN/STDOUT and WebSocket coexist.** STDIN/STDOUT is for training speed. WebSocket is for human play. They are not mutually exclusive — both will exist in production.

4. **The encoder is brittle.** Any change to game constants (resources, locations, items, actions) breaks `OBS_SIZE` and invalidates checkpoints. See `CHANGE-GUIDE.md`.

5. **The reducer is pure.** `gameReducer(state, action) => newState` must remain a pure function with no side effects. This is what makes the engine usable as an RL environment.
