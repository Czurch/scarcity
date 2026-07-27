# Scarcity — System Architecture

## What This Project Is

Scarcity is a post-apocalyptic survival board game (2–4 players). Directors manage survivor colonies competing for scarce resources. Last colony standing wins.

**Core loop:** Survivor Draft → Declare Actions → Conflict Resolution → Looting → Upkeep → repeat

This repository contains the game engine, an RL training pipeline, and scaffolding for future human-facing clients. The engine is the source of truth for all game rules.

---

## Workspace Structure

```
Scarcity/
├── gameBackend/        ← TypeScript game engine + match server
├── rlAgent/            ← Python RL training pipeline
├── frontend/           ← React + Vite web client for human play
└── docs/               ← This folder
```

### gameBackend/

TypeScript + ts-node. All game logic lives here.

| Path | Purpose |
|---|---|
| `src/types.ts` | All type definitions — canonical data model |
| `src/data/` | Static game data: 24 survivor templates, 9 locations, items |
| `src/engine/reducer.ts` | Pure Redux-style reducer: `createInitialState`, `gameReducer` |
| `src/engine/phases/` | Phase logic: draft, actionSelection, conflictResolution, looting, upkeep |
| `src/engine/ai.ts` | Rule-based CPU AI (4 strategies: balanced, rusher, hoarder, raider) |
| `src/GameEngine.ts` | Public API: `getState()`, `autoAdvance()`, `submitIntents()`, etc. |
| `src/server/protocol.ts` | JSON message types (transport-agnostic) — the agent contract |
| `src/server/webProtocol.ts` | Lobby message types + human-facing additions; reuses `protocol.ts` shapes for in-game messages |
| `src/server/transport.ts` | `Transport` interface |
| `src/server/transports/stdio.ts` | STDIN/STDOUT implementation (used for RL training) |
| `src/server/transports/websocket.ts` | Single-peer `WebSocketTransport implements Transport` (used for RL agent seats) |
| `src/server/session.ts` | Serial game loop for RL training — drives engine, pauses at agent seats, routes via Transport |
| `src/server/room.ts` | `Room` — lobby/seat-claiming + event-driven multi-human game loop (broadcasts state, fans out `*_request` to every pending seat) for the web server |
| `src/server/web-server.ts` | Entry point for hosting friends over WebSocket (`npm run web-server`) — holds a `Map<roomId, Room>` |
| `src/server/index.ts` | Entry point for the RL training match server (stdio) |
| `src/cli/` | Interactive CLI for human play (separate from the server) |

### rlAgent/

Python + PyTorch. Trains an actor-critic model via PPO self-play.

| Path | Purpose |
|---|---|
| `agent/client.py` | Spawns game server subprocess, wraps STDIN/STDOUT send/recv |
| `agent/encoder.py` | `GameState` dict → fixed 813-dim float tensor + action masks |
| `agent/model.py` | `ActorCritic` network (556K params): shared trunk + 6 heads |
| `agent/decoder.py` | Model logits + masks → protocol response messages |
| `training/rollout.py` | `Step` dataclass, `RolloutBuffer` with GAE advantage computation |
| `training/ppo.py` | PPO loss + update loop |
| `train.py` | Main training entry point (runs indefinitely) |
| `play_verbose.py` | Play one game with a trained model, save detailed JSON log |
| `run_random.py` | Baseline: random agent for protocol validation |
| `checkpoints/` | Saved model weights (`.pt` files, every 25 updates) |
| `game-logs/` | Verbose game logs from `play_verbose.py` |

---

## How the Pieces Connect

### Training (current)

```
train.py
  └── GameClient (agent/client.py)
        └── subprocess: npx ts-node ../gameBackend/src/server/index.ts
              └── StdioTransport ←→ session.ts ←→ GameEngine
```

Python spawns one TS server subprocess per game. Communication is newline-delimited JSON over STDIN/STDOUT. One Python process handles all 4 agent seats sequentially (Option A self-play).

**Why STDIN/STDOUT for training:** Zero network overhead. Each game spawns a fresh server process. ts-node startup (~5s) is the main bottleneck — pre-compiling with `tsc` would help at scale.

### Human Play — CLI (vs RL agent, local)

```
Human (local CLI prompts) ─┐
                            ├── play-vs-rl.ts ←→ GameEngine
RL Agent (Python)  ── WebSocketTransport ──┘
```

`play-vs-rl.ts` hosts one WebSocket connection for a single RL agent process while the human plays via local `cli/prompts.ts` stdin prompts. Unchanged by the web frontend work below.

### Human Play — Web (friends over the network)

```
Browser Client (frontend/, React)
  └── WebSocket ──────────────────────→ web-server.ts → Room → GameEngine
Browser Client (friend 2..N)
  └── WebSocket ──────────────────────→ (same Room)
```

`web-server.ts` hosts one or more `Room`s. Each `Room` runs a lobby (seat claiming, rejoin tokens) and, once started, an **event-driven** loop: after every mutation it broadcasts full state to every connected seat and sends `*_request` to whichever human seats are currently pending (possibly several at once, e.g. during `action_selection`). This differs from `session.ts`'s serial one-transport-at-a-time loop, which assumes exactly one counterparty — the web server has N independent sockets instead. Unfilled seats become CPU automatically (a seat absent from both `humanPlayerIndices` and `agentPlayerIndices` is CPU per the reducer).

`frontend/` shares `gameBackend`'s `types.ts`/`protocol.ts`/`webProtocol.ts` directly via a Vite path alias (`@game/*` → `../gameBackend/src/*`), not a monorepo workspace — no type duplication, no build restructuring.

Hosting a game for friends over the internet is the host's own responsibility (port-forward, ngrok, Tailscale, etc.) — not automated by this codebase.

All three human-play/agent paths — STDIN/STDOUT training, CLI-vs-agent, and the web server — coexist. None of them modify `session.ts`, `transport.ts`, or the CLI.

The protocol messages (`ServerMessage` / `AgentMessage` in `protocol.ts`) are identical over both `StdioTransport` and `WebSocketTransport`, and are reused as-is for human web clients in `webProtocol.ts`.

---

## The Protocol (Transport-Agnostic)

All communication between the server and external seats uses newline-delimited JSON.

**Server → Client:**
| Message | When | Key fields |
|---|---|---|
| `game_start` | Once per agent seat at game start | `playerId`, `playerName`, `state` |
| `draft_request` | Each draft pick for this seat | `playerId`, `state` |
| `action_request` | Each action phase for this seat | `playerId`, `state` |
| `loot_request` | When this seat has loot to claim | `playerId`, `lootId`, `state` |
| `upkeep_request` | Each upkeep phase for this seat | `playerId`, `state` |
| `game_over` | Game ends | `winnerId`, `state` |

**Client → Server:**
| Message | In response to | Key fields |
|---|---|---|
| `draft_response` | `draft_request` | `playerId`, `survivorId` |
| `action_response` | `action_request` | `playerId`, `intents[]` |
| `loot_response` | `loot_request` | `playerId`, `lootId`, `tokenIndices[]` |
| `upkeep_response` | `upkeep_request` | `playerId`, `allocations` |

Every message carries `gameId` for future multiplexing (multiple concurrent games on one WebSocket connection).

---

## Player Seat Types

The engine supports three seat types, set via `GameConfig`:

| Type | Flag | Behavior |
|---|---|---|
| CPU | `isHuman=false, isAgent=false` | Auto-played by `engine.ai.ts` on `AUTO_ADVANCE` |
| Human | `isHuman=true` | Engine pauses; external input expected (CLI prompts) |
| Agent | `isAgent=true` | Engine pauses; external input expected (protocol message) |

`humanPlayerIndices` and `agentPlayerIndices` in `GameConfig` set these at game creation. A game can have any mix of the three types.
