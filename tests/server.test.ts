import { describe, it, expect } from 'vitest';
import { connectClient, textOf } from './helpers.js';

describe('MCP server', () => {
  it('advertises its tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('ping');
  });

  it('answers ping with its version', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(textOf(result)).toMatch(/^pong \(mcp-qa-assistant v\d+\.\d+\.\d+\)$/);
  });
});
