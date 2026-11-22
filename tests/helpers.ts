import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import type { ExportOptions } from '../src/tools/exportTool.js';

/** Connects a real MCP client to the server in memory: tests exercise the actual protocol, not internals. */
export async function connectClient(options: { export?: ExportOptions } = {}): Promise<Client> {
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
