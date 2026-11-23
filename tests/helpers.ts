import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type ServerOptions } from '../src/server.js';

/** Connects a real MCP client to the server in memory: tests exercise the actual protocol, not internals. */
export async function connectClient(options: ServerOptions = {}): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(options);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

export function textOf(result: Record<string, unknown>): string {
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}
