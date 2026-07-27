/**
 * Web server entry point — hosts one or more Rooms over WebSocket for browser clients.
 *
 * Usage (from gameBackend/):
 *   npm run web-server
 *   npm run web-server -- --port=8080 --max-players=4
 *
 * Clients connect to ws://<host>:<port>/?room=<roomId> (roomId defaults to "main").
 * The first connection to a given room creates it (sized by --max-players); everyone
 * else joins that same room. Send { type: 'join', name } once connected.
 */

import { WebSocketServer } from 'ws';
import { Room } from './room';

const cliArgs = process.argv.slice(2);

const portArg = cliArgs.find((a) => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.replace('--port=', ''), 10) : 8080;

const maxPlayersArg = cliArgs.find((a) => a.startsWith('--max-players='));
const DEFAULT_MAX_PLAYERS = maxPlayersArg ? parseInt(maxPlayersArg.replace('--max-players=', ''), 10) : 4;

const rooms = new Map<string, Room>();

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const roomId = url.searchParams.get('room') ?? 'main';

  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId, DEFAULT_MAX_PLAYERS);
    rooms.set(roomId, room);
    console.log(`  Room "${roomId}" created (max ${DEFAULT_MAX_PLAYERS} players)`);
  }

  room.handleConnection(socket);
});

console.log('\n  ╔══════════════════════════════════╗');
console.log('  ║      SCARCITY  —  Web Server     ║');
console.log('  ╚══════════════════════════════════╝\n');
console.log(`  Listening on ws://localhost:${PORT}`);
console.log(`  Default room "main" holds up to ${DEFAULT_MAX_PLAYERS} players.\n`);
