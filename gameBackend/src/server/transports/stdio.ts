import * as readline from 'readline';
import { Transport } from '../transport';
import { ServerMessage, AgentMessage } from '../protocol';

export class StdioTransport implements Transport {
  private rl: readline.Interface;
  private lineQueue: string[] = [];
  private waiters: ((line: string) => void)[] = [];

  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (this.waiters.length > 0) {
        this.waiters.shift()!(trimmed);
      } else {
        this.lineQueue.push(trimmed);
      }
    });
  }

  async send(message: ServerMessage): Promise<void> {
    process.stdout.write(JSON.stringify(message) + '\n');
  }

  async receive(): Promise<AgentMessage> {
    if (this.lineQueue.length > 0) {
      return JSON.parse(this.lineQueue.shift()!) as AgentMessage;
    }
    return new Promise((resolve) => {
      this.waiters.push((line) => resolve(JSON.parse(line) as AgentMessage));
    });
  }

  async close(): Promise<void> {
    this.rl.close();
  }
}
