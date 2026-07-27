/**
 * Worker entry point — routes lobby-code creation and WebSocket connections
 * to the right RoomDurableObject (one Durable Object instance per room).
 */

export { RoomDurableObject } from './roomDurableObject';

interface Env {
  ROOMS: DurableObjectNamespace;
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L — avoids ambiguity when read aloud
const CODE_LENGTH = 5;

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/rooms') {
      if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

      const roomId = generateRoomCode();
      return new Response(JSON.stringify({ roomId }), {
        headers: { 'content-type': 'application/json', ...corsHeaders },
      });
    }

    const roomId = url.searchParams.get('room');
    if (!roomId) return new Response('Missing room parameter', { status: 400 });

    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
};
