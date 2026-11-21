import { matchKey } from './compare.js';
import type { TestCase } from './parse.js';

export interface TestHistory {
  key: string;
  test: TestCase;
  runs: number;
  passed: number;
  flaky: number;
  failed: number;
  /** Share of runs where the test did not pass cleanly (flaky or failed), 0..1. */
  instability: number;
  /** Outcome per run, oldest first, e.g. "✓ ~ ✗ ✓" ("-" = not run or skipped). */
  timeline: string;
}

const symbol: Record<TestCase['outcome'], string> = { passed: '✓', flaky: '~', failed: '✗', skipped: '-' };

/**
 * Builds a per-test history across several runs (oldest first) and ranks unstable tests.
 * A test is "unstable" if it flaked or failed in at least one run but also passed in at least one:
 * tests failing in every run are a consistent failure, not flakiness, and are reported separately.
 */
export function buildHistory(runs: TestCase[][]): { unstable: TestHistory[]; alwaysFailing: TestHistory[] } {
  const keys = new Map<string, TestCase>();
  for (const run of runs) for (const tc of run) if (!keys.has(matchKey(tc))) keys.set(matchKey(tc), tc);

  const histories: TestHistory[] = [];
  for (const [key, sample] of keys) {
    const outcomes = runs.map((run) => run.find((tc) => matchKey(tc) === key)?.outcome);
    const counted = outcomes.filter((o): o is TestCase['outcome'] => o !== undefined && o !== 'skipped');
    const passed = counted.filter((o) => o === 'passed').length;
    const flaky = counted.filter((o) => o === 'flaky').length;
    const failed = counted.filter((o) => o === 'failed').length;
    histories.push({
      key,
      test: sample,
      runs: counted.length,
      passed,
      flaky,
      failed,
      instability: counted.length ? (flaky + failed) / counted.length : 0,
      timeline: outcomes.map((o) => (o ? symbol[o] : '-')).join(' '),
    });
  }

  const byInstability = (a: TestHistory, b: TestHistory) =>
    b.instability - a.instability || b.flaky - a.flaky || a.key.localeCompare(b.key);

  return {
    unstable: histories.filter((h) => h.flaky + h.failed > 0 && (h.passed > 0 || h.flaky > 0) && h.failed < h.runs).sort(byInstability),
    alwaysFailing: histories.filter((h) => h.runs > 0 && h.failed === h.runs).sort(byInstability),
  };
}
