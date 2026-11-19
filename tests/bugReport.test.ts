import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { collectTests, loadReport } from '../src/report/parse.js';
import { draftBugReport, splitExpectation, suggestSeverity } from '../src/report/bugReport.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const load = async () => collectTests(await loadReport(fixture('report.json')));

describe('splitExpectation', () => {
  it('extracts expected and received values from assertion errors', () => {
    expect(splitExpectation('expect(received).toBe(expected)\n\nExpected: 3.84\nReceived: 3.83')).toEqual({
      expected: '3.84',
      actual: '3.83',
    });
  });

  it('handles qualified labels like "Expected pattern"', () => {
    expect(splitExpectation('Expected pattern: /inventory/\nReceived string: "https://x/"')).toEqual({
      expected: '/inventory/',
      actual: '"https://x/"',
    });
  });

  it('falls back to the first lines of a non-assertion error', () => {
    expect(splitExpectation('Error: strict mode violation\n  resolved to 6 elements\n\n  at x.ts:1')).toEqual({
      actual: 'Error: strict mode violation resolved to 6 elements at x.ts:1',
    });
  });

  it('copes with a missing error', () => {
    expect(splitExpectation(undefined).actual).toMatch(/without an error message/);
  });
});

describe('suggestSeverity', () => {
  it('rates a consistently failing @smoke test as high', async () => {
    const [failed] = await load();
    expect(suggestSeverity(failed!).severity).toBe('high');
  });

  it('rates a flaky test as low and says why', async () => {
    const flaky = (await load())[1]!;
    const { severity, reason } = suggestSeverity(flaky);
    expect(severity).toBe('low');
    expect(reason).toMatch(/passed on retry/);
  });
});

describe('draftBugReport', () => {
  it('produces a complete report for a failed test', async () => {
    const [failed] = await load();
    const bug = draftBugReport(failed!, {
      environment: 'saucedemo.com (prod demo)',
      playwrightVersion: '1.49.0',
      runStartedAt: '2026-11-17T18:19:40.000Z',
    });

    expect(bug.title).toBe('[End-to-end purchase] a customer can buy several items with correct totals: 3.83');
    expect(bug.markdown).toContain('**Severity:** high');
    expect(bug.markdown).toContain('**Frequency:** Consistent: failed on all 2 attempts.');
    expect(bug.markdown).toContain('- **Environment:** saucedemo.com (prod demo)');
    expect(bug.markdown).toContain('- **Playwright:** 1.49.0');
    expect(bug.markdown).toContain('4. verify the price summary is calculated correctly ← **fails here**');
    expect(bug.markdown).toContain(
      '## Expected result\nA customer can buy several items with correct totals.\nAssertion expected: `3.84`',
    );
    expect(bug.markdown).toContain('## Actual result\nAssertion received: `3.83`');
    expect(bug.markdown).toContain('`test-results/checkout-e2e/trace.zip`');
    expect(bug.markdown).toContain('npx playwright test ui/checkout.spec.ts:62 --project=chromium --trace on');
  });

  it('respects a severity override', async () => {
    const [failed] = await load();
    const bug = draftBugReport(failed!, { severity: 'critical' });
    expect(bug.severity).toBe('critical');
    expect(bug.markdown).toContain('**Severity:** critical: Set by the reporter.');
  });

  it('describes a flaky test as intermittent', async () => {
    const flaky = (await load())[1]!;
    const bug = draftBugReport(flaky);
    expect(bug.markdown).toContain('Intermittent: failed on the first attempt, passed on retry');
    expect(bug.markdown).toContain('The test records no individual steps.');
  });

  it('never leaves three blank lines in a row', async () => {
    for (const tc of await load()) expect(draftBugReport(tc).markdown).not.toMatch(/\n{3,}/);
  });
});
