import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { collectTests, loadReport } from '../src/report/parse.js';
import { buildHistory } from '../src/report/history.js';
import { connectClient, textOf } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const run = async (name: string) => collectTests(await loadReport(fixture(name)));
const RUNS = ['baseline.json', 'report.json', 'later.json'];

describe('buildHistory', () => {
  it('ranks tests that are sometimes unstable, most unstable first', async () => {
    const { unstable } = buildHistory(await Promise.all(RUNS.map(run)));
    const byTitle = Object.fromEntries(unstable.map((h) => [h.test.titlePath.at(-1), h]));

    expect(unstable[0]!.test.titlePath.at(-1)).toBe('add to cart on the details page is reflected back on the products page');
    expect(byTitle['add to cart on the details page is reflected back on the products page']).toMatchObject({
      runs: 3, passed: 1, flaky: 2, failed: 0, timeline: '✓ ~ ~',
    });
    expect(byTitle['a customer can buy several items with correct totals']).toMatchObject({
      runs: 3, passed: 2, failed: 1, timeline: '✓ ✗ ✓',
    });
    expect(byTitle['shows the same name and price as the product clicked in the list']!.timeline).toBe('✗ ✓ ✓');
  });

  it('keeps skipped and missing runs out of the counts but visible in the timeline', async () => {
    const { unstable, alwaysFailing } = buildHistory(await Promise.all(RUNS.map(run)));
    const all = [...unstable, ...alwaysFailing].map((h) => h.test.titlePath.at(-1));
    expect(all).not.toContain('health check responds');
    expect(all).not.toContain('deleted booking returns 404');
  });

  it('separates tests that fail in every run from flaky ones', async () => {
    const same = await run('report.json');
    const { unstable, alwaysFailing } = buildHistory([same, same]);
    expect(alwaysFailing.map((h) => h.test.titlePath.at(-1))).toEqual(['a customer can buy several items with correct totals']);
    expect(unstable.map((h) => h.test.titlePath.at(-1))).toEqual([
      'add to cart on the details page is reflected back on the products page',
    ]);
  });
});

describe('flaky_history over MCP', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });

  it('returns a ranked, readable history', async () => {
    const out = textOf(
      await client.callTool({ name: 'flaky_history', arguments: { reportPaths: RUNS.map(fixture) } }),
    );
    expect(out).toContain('Analysed 3 runs.');
    expect(out).toContain('## Unstable tests (3)');
    expect(out).toContain('✓ ~ ~  ·  unstable in 2/3 runs (67%): 2 flaky, 0 failed');
    expect(out).not.toContain('## Failing in every run');
  });

  it('respects the top limit', async () => {
    const out = textOf(
      await client.callTool({ name: 'flaky_history', arguments: { reportPaths: RUNS.map(fixture), top: 1 } }),
    );
    expect(out).toContain('## Unstable tests (3, top 1 shown)');
    expect(out.match(/^- /gm)).toHaveLength(1);
  });

  it('needs at least two reports', async () => {
    const result = await client.callTool({ name: 'flaky_history', arguments: { reportPaths: [fixture('report.json')] } });
    expect(result.isError).toBe(true);
  });
});
