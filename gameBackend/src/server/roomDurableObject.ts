import { DurableObject } from 'cloudflare:workers';
import { Room } from './room';

export class RoomDurableObject extends DurableObject {
  private room: Room | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket upgrade', { status: 426 });
    }

    if (!this.room) {
      const url = new URL(request.url);
      const roomId = url.searchParams.get('room') ?? 'unknown';
      const maxPlayers = Number(url.searchParams.get('maxPlayers')) || 4;
      this.room = new Room(roomId, maxPlayers);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.room.handleConnection(server);

    return new Response(null, { status: 101, webSocket: client });
  }
}
