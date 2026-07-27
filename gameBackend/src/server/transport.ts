import { ServerMessage, AgentMessage } from './protocol';

export interface Transport {
  send(message: ServerMessage): Promise<void>;
  receive(): Promise<AgentMessage>;
  close(): Promise<void>;
}
