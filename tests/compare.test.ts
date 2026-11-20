import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { collectTests, loadReport } from '../src/report/parse.js';
import { compareRuns, matchKey } from '../src/report/compare.js';
import { connectClient, textOf } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const tests = async (name: string) => collectTests(await loadReport(fixture(name)));
const titles = (list: { titlePath: string[] }[]) => list.map((t) => t.titlePath.at(-1));

describe('compareRuns', () => {
  it('classifies every change between two runs', async () => {
    const c = compareRuns(await tests('baseline.json'), await tests('report.json'));

    expect(titles(c.newFailures)).toEqual(['a customer can buy several items with correct totals']);
    expect(titles(c.newlyFlaky)).toEqual(['add to cart on the details page is reflected back on the products page']);
    expect(titles(c.fixed)).toEqual(['shows the same name and price as the product clicked in the list']);
    expect(c.stillFailing).toEqual([]);
    expect(titles(c.removed)).toEqual(['deleted booking returns 404']);
    expect(c.added).toEqual([]);
  });

  it('matches tests even when their line number moved', async () => {
    const before = await tests('baseline.json');
    const after = await tests('report.json');
    const moved = (list: typeof before) => list.find((t) => t.titlePath.at(-1)?.startsWith('add to cart'))!;
    expect(moved(before).line).not.toBe(moved(after).line);
    expect(matchKey(moved(before))).toBe(matchKey(moved(after)));
  });

  it('ignores tests that were skipped in either run', async () => {
    const c = compareRuns(await tests('baseline.json'), await tests('report.json'));
    const all = [...c.newFailures, ...c.fixed, ...c.stillFailing, ...c.newlyFlaky];
    expect(titles(all)).not.toContain('health check responds');
  });

  it('reports a test failing in both runs as still failing', async () => {
    const run = await tests('report.json');
    const c = compareRuns(run, run);
    expect(titles(c.stillFailing)).toEqual(['a customer can buy several items with correct totals']);
    expect(c.newFailures).toEqual([]);
  });
});

describe('compare_runs over MCP', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });

  it('leads with the new failures and lists every category', async () => {
    const out = textOf(
      await client.callTool({
        name: 'compare_runs',
        arguments: { baselineReportPath: fixture('baseline.json'), currentReportPath: fixture('report.json') },
      }),
    );
    expect(out).toContain('Compared 5 baseline tests with 4 current tests.');
    expect(out).toContain('⚠️ 1 new failure since the baseline: start with these.');
    expect(out).toContain('## New failures (1)');
    expect(out).toContain('error: expected 3.84, received 3.83');
    expect(out).toContain('## Newly flaky (1)');
    expect(out).toContain('## Fixed (1)');
    expect(out).toContain('## Removed tests (1)');
    expect(out).not.toContain('## Still failing');
  });

  it('returns a tool error for a missing report', async () => {
    const result = await client.callTool({
      name: 'compare_runs',
      arguments: { baselineReportPath: fixture('missing.json'), currentReportPath: fixture('report.json') },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Cannot read report file');
  });
});
