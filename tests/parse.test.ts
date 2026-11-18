import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { collectTests, loadReport, ReportError, stripAnsi } from '../src/report/parse.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe('report parsing', () => {
  it('flattens nested suites into test cases with readable title paths', async () => {
    const tests = collectTests(await loadReport(fixture('report.json')));

    expect(tests).toHaveLength(4);
    expect(tests[0]!.titlePath).toEqual(['End-to-end purchase', 'a customer can buy several items with correct totals']);
    expect(tests[0]!.id).toBe(
      'ui/checkout.spec.ts:62 › End-to-end purchase › a customer can buy several items with correct totals [chromium]',
    );
  });

  it('maps Playwright statuses to outcomes', async () => {
    const tests = collectTests(await loadReport(fixture('report.json')));
    expect(tests.map((t) => t.outcome)).toEqual(['failed', 'flaky', 'passed', 'skipped']);
  });

  it('finds the step where a test failed and strips ANSI colours from errors', async () => {
    const [failed] = collectTests(await loadReport(fixture('report.json')));

    expect(failed!.failedStep).toBe('verify the price summary is calculated correctly › expect.toBe');
    expect(failed!.error).toContain('Expected: 3.84');
    expect(failed!.error).not.toContain('\u001b');
    expect(failed!.attempts).toBe(2);
    expect(failed!.attachments.map((a) => a.name)).toEqual(['screenshot', 'trace']);
  });

  it('explains a flaky test with its first failure, not its final pass', async () => {
    const flaky = collectTests(await loadReport(fixture('report.json')))[1]!;
    expect(flaky.error).toContain('strict mode violation');
    expect(flaky.durationMs).toBe(6400);
  });

  it('rejects files that are not Playwright reports with a helpful message', async () => {
    await expect(loadReport(fixture('not-a-report.json'))).rejects.toThrow(ReportError);
    await expect(loadReport(fixture('not-a-report.json'))).rejects.toThrow(/--reporter=json/);
    await expect(loadReport(fixture('missing.json'))).rejects.toThrow(/Cannot read report file/);
  });

  it('stripAnsi removes colour codes only', () => {
    expect(stripAnsi('\u001b[31mred\u001b[39m text')).toBe('red text');
  });
});
