import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SERVER_NAME = 'mcp-qa-assistant';
export const SERVER_VERSION = '0.1.0';

/**
 * Builds the MCP server and registers its tools.
 * Kept separate from the stdio entry point so tests can connect to it in memory.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Health check. Returns "pong" and the server version.',
    },
    async () => ({
      content: [{ type: 'text', text: `pong (${SERVER_NAME} v${SERVER_VERSION})` }],
    }),
  );

  return server;
}
