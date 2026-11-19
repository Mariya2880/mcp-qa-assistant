import { readFile } from 'node:fs/promises';
import { ReportSchema, type Report, type Spec, type Suite, type TestEntry, type Step } from './types.js';

export type Outcome = 'failed' | 'flaky' | 'passed' | 'skipped';

export interface TestCase {
  /** Stable id: `<file>:<line> › <title path> [<project>]` */
  id: string;
  titlePath: string[];
  file: string;
  line?: number;
  project: string;
  tags: string[];
  outcome: Outcome;
  attempts: number;
  durationMs: number;
  error?: string;
  failedStep?: string;
  steps: string[];
  attachments: { name: string; contentType: string; path?: string }[];
  annotations: { type: string; description?: string }[];
}

export class ReportError extends Error {}

export async function loadReport(path: string): Promise<Report> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ReportError(`Cannot read report file: ${path}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ReportError(`Report is not valid JSON: ${path}`);
  }
  const parsed = ReportSchema.safeParse(json);
  if (!parsed.success) {
    throw new ReportError(
      `Not a Playwright JSON report (${parsed.error.issues[0]?.message ?? 'unknown shape'}). ` +
        'Generate one with: npx playwright test --reporter=json > report.json',
    );
  }
  return parsed.data;
}

const outcomeOf = (status: TestEntry['status']): Outcome =>
  ({ unexpected: 'failed', flaky: 'flaky', expected: 'passed', skipped: 'skipped' } as const)[status];

/** Strips ANSI colour codes Playwright puts into error messages. */
// eslint-disable-next-line no-control-regex
export const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

function flattenSteps(steps: Step[], depth = 0): { titles: string[]; failed?: string } {
  const titles: string[] = [];
  let failed: string | undefined;
  for (const step of steps) {
    titles.push(`${'  '.repeat(depth)}${step.title}`);
    const nested = flattenSteps(step.steps ?? [], depth + 1);
    titles.push(...nested.titles);
    // Report the path from the business step down to the failing assertion, e.g. "verify totals › expect.toBe".
    if (!failed && step.error) failed = nested.failed ? `${step.title} › ${nested.failed}` : step.title;
  }
  return { titles, failed };
}

function toTestCase(spec: Spec, test: TestEntry, titlePath: string[]): TestCase {
  const failures = test.results.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
  // A flaky test is explained by its first failure; a failed test by its last attempt.
  const explaining = (test.status === 'flaky' ? failures[0] : failures.at(-1)) ?? test.results.at(-1);
  const error = explaining?.error?.message ?? explaining?.errors[0]?.message;
  // Retries often record no steps, so take steps from the latest failing attempt that has them.
  const withSteps = [...failures].reverse().find((r) => r.steps.length > 0) ?? explaining;
  const { titles, failed } = flattenSteps(withSteps?.steps ?? []);
  // Traces are usually only captured on retry: collect attachments from every failing attempt.
  const attachments = failures.flatMap((r) => r.attachments);

  return {
    id: `${spec.file}:${spec.line ?? 0} › ${titlePath.join(' › ')} [${test.projectName}]`,
    titlePath,
    file: spec.file,
    line: spec.line,
    project: test.projectName,
    tags: spec.tags,
    outcome: outcomeOf(test.status),
    attempts: test.results.length,
    durationMs: test.results.reduce((sum, r) => sum + r.duration, 0),
    error: error ? stripAnsi(error) : undefined,
    failedStep: failed,
    steps: titles,
    attachments,
    annotations: test.annotations,
  };
}

/** Flattens Playwright's nested suite tree into one list of test cases. */
export function collectTests(report: Report): TestCase[] {
  const out: TestCase[] = [];
  const walk = (suite: Suite, path: string[], isFile: boolean): void => {
    // Top-level suites are files; their title is the file name, so it is left out of the title path.
    const here = isFile ? path : [...path, suite.title];
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) out.push(toTestCase(spec, test, [...here, spec.title]));
    }
    for (const child of suite.suites ?? []) walk(child, here, false);
  };
  for (const suite of report.suites) walk(suite, [], true);
  return out;
}

export type FindResult = { ok: true; test: TestCase } | { ok: false; message: string };

/** Finds one test by exact id, or by a case-insensitive fragment of its id/title. */
export function findTest(tests: TestCase[], query: string): FindResult {
  const exact = tests.filter((t) => t.id === query);
  const needle = query.toLowerCase();
  const matches = exact.length ? exact : tests.filter((t) => t.id.toLowerCase().includes(needle));
  if (matches.length === 0) return { ok: false, message: `No test matches "${query}".` };
  if (matches.length > 1) {
    return {
      ok: false,
      message: `"${query}" matches ${matches.length} tests; be more specific:\n${matches.map((m) => `- ${m.id}`).join('\n')}`,
    };
  }
  return { ok: true, test: matches[0]! };
}
