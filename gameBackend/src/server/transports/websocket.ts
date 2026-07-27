import { WebSocket } from 'ws';
import { Transport } from '../transport';
import { ServerMessage, AgentMessage } from '../protocol';

export class WebSocketTransport implements Transport {
  private queue: AgentMessage[] = [];
  private waiters: ((msg: AgentMessage) => void)[] = [];

  constructor(private socket: WebSocket) {
    socket.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as AgentMessage;
      if (this.waiters.length > 0) {
        this.waiters.shift()!(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  async send(message: ServerMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.send(JSON.stringify(message), (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  async receive(): Promise<AgentMessage> {
    if (this.queue.length > 0) return this.queue.shift()!;
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async close(): Promise<void> {
    this.socket.close();
  }
}
