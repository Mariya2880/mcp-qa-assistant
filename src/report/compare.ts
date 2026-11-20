import type { TestCase } from './parse.js';

export interface RunComparison {
  /** Passed (or flaky) before, failing now: the regressions to look at first. */
  newFailures: TestCase[];
  /** Failing before, passing now. */
  fixed: TestCase[];
  /** Failing in both runs. */
  stillFailing: TestCase[];
  /** Clean pass before, flaky now: an early warning sign. */
  newlyFlaky: TestCase[];
  /** Present only in the current run. */
  added: TestCase[];
  /** Present only in the baseline run. */
  removed: TestCase[];
}

/**
 * Line numbers move whenever a file is edited, so tests are matched on
 * file + title path + project instead of the full id.
 */
export const matchKey = (tc: TestCase): string => `${tc.file} › ${tc.titlePath.join(' › ')} [${tc.project}]`;

const isFailing = (tc: TestCase): boolean => tc.outcome === 'failed';

export function compareRuns(baseline: TestCase[], current: TestCase[]): RunComparison {
  const before = new Map(baseline.map((t) => [matchKey(t), t]));
  const after = new Map(current.map((t) => [matchKey(t), t]));
  const result: RunComparison = { newFailures: [], fixed: [], stillFailing: [], newlyFlaky: [], added: [], removed: [] };

  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) {
      result.added.push(now);
      continue;
    }
    // A test skipped in either run tells us nothing about a change in behaviour.
    if (was.outcome === 'skipped' || now.outcome === 'skipped') continue;

    if (isFailing(now) && !isFailing(was)) result.newFailures.push(now);
    else if (!isFailing(now) && isFailing(was) && now.outcome === 'passed') result.fixed.push(now);
    else if (isFailing(now) && isFailing(was)) result.stillFailing.push(now);
    else if (now.outcome === 'flaky' && was.outcome === 'passed') result.newlyFlaky.push(now);
  }
  for (const [key, was] of before) if (!after.has(key)) result.removed.push(was);

  return result;
}
