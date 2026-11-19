import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectClient, textOf } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('report tools over MCP', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });

  it('exposes list_failures and get_failure_details with input schemas', async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.list_failures?.inputSchema.required).toContain('reportPath');
    expect(byName.get_failure_details?.inputSchema.required).toEqual(expect.arrayContaining(['reportPath', 'test']));
  });

  it('list_failures summarises the run and lists failed + flaky tests', async () => {
    const out = textOf(await client.callTool({ name: 'list_failures', arguments: { reportPath: fixture('report.json') } }));

    expect(out).toContain('Report: 4 tests: 1 passed, 1 failed, 1 flaky, 1 skipped.');
    expect(out).toContain('[FAILED] End-to-end purchase › a customer can buy several items with correct totals');
    expect(out).toContain('[FLAKY] Product details page › add to cart');
    expect(out).not.toContain('shows the same name and price');
  });

  it('list_failures can leave flaky tests out', async () => {
    const out = textOf(
      await client.callTool({ name: 'list_failures', arguments: { reportPath: fixture('report.json'), includeFlaky: false } }),
    );
    expect(out).not.toContain('[FLAKY]');
  });

  it('list_failures celebrates a clean run', async () => {
    const out = textOf(await client.callTool({ name: 'list_failures', arguments: { reportPath: fixture('passing.json') } }));
    expect(out).toContain('No failures.');
  });

  it('get_failure_details returns error, failed step and attachments', async () => {
    const out = textOf(
      await client.callTool({
        name: 'get_failure_details',
        arguments: { reportPath: fixture('report.json'), test: 'correct totals' },
      }),
    );

    expect(out).toContain('Failed at step: verify the price summary is calculated correctly');
    expect(out).toContain('Received: 3.83');
    expect(out).toContain('trace (application/zip): test-results/checkout-e2e/trace.zip');
    expect(out).toContain('Tags: @smoke, @e2e');
  });

  it('get_failure_details asks for a more specific name when several tests match', async () => {
    const result = await client.callTool({
      name: 'get_failure_details',
      arguments: { reportPath: fixture('report.json'), test: 'products.spec' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/matches 2 tests/);
  });

  it('returns a tool error (not a crash) for a bad report path', async () => {
    const result = await client.callTool({ name: 'list_failures', arguments: { reportPath: fixture('missing.json') } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Cannot read report file');
  });

  it('rejects invalid input via the schema', async () => {
    const result = await client.callTool({ name: 'list_failures', arguments: { reportPath: '' } });
    expect(result.isError).toBe(true);
  });
});

describe('draft_bug_report over MCP', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });

  it('drafts a report for a failed test, using the report metadata', async () => {
    const out = textOf(
      await client.callTool({
        name: 'draft_bug_report',
        arguments: { reportPath: fixture('report.json'), test: 'correct totals', environment: 'CI' },
      }),
    );
    expect(out).toMatch(/^# \[End-to-end purchase\]/);
    expect(out).toContain('- **Playwright:** 1.49.0');
    expect(out).toContain('- **Run started:** 2026-11-17T18:19:40.000Z');
    expect(out).toContain('- **Environment:** CI');
  });

  it('refuses to draft a bug for a passing test', async () => {
    const result = await client.callTool({
      name: 'draft_bug_report',
      arguments: { reportPath: fixture('report.json'), test: 'same name and price' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/passed: there is no failure to report/);
  });

  it('rejects an unknown severity value', async () => {
    const result = await client.callTool({
      name: 'draft_bug_report',
      arguments: { reportPath: fixture('report.json'), test: 'correct totals', severity: 'urgent' },
    });
    expect(result.isError).toBe(true);
  });
});
