#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
await server.connect(new StdioServerTransport());

// stdout is reserved for the MCP protocol; log to stderr only.
console.error('mcp-qa-assistant running on stdio');
