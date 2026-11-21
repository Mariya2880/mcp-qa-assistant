import type { TestCase } from './parse.js';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface BugReportContext {
  playwrightVersion?: string;
  runStartedAt?: string;
  /** Free-text environment from the user, e.g. "staging, build 2026.11.3". */
  environment?: string;
  /** Overrides the suggested severity. */
  severity?: Severity;
}

export interface BugReport {
  title: string;
  severity: Severity;
  severityReason: string;
  markdown: string;
}

/**
 * Splits Playwright's assertion message into expected/actual where it follows the
 * standard "Expected: … / Received: …" format; otherwise the error is the actual result.
 */
export function splitExpectation(error: string | undefined): { expected?: string; actual: string } {
  if (!error) return { actual: 'The test failed without an error message.' };
  const expected = error.match(/^\s*Expected(?: [\w ]+)?:\s*(.+)$/m)?.[1]?.trim();
  const received = error.match(/^\s*Received(?: [\w ]+)?:\s*(.+)$/m)?.[1]?.trim();
  if (expected && received) return { expected, actual: received };
  return { actual: error.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' ') };
}

/** One-line error for lists: "expected X, received Y" for assertions, otherwise the first line. */
export function summariseError(error: string | undefined): string | undefined {
  if (!error) return undefined;
  const { expected, actual } = splitExpectation(error);
  return expected ? `expected ${expected}, received ${actual}` : error.split('\n')[0]?.trim();
}

/**
 * Suggests a severity from what the test protects (its tags) and how it failed.
 * The reason is always returned, so a human can disagree with it quickly.
 */
export function suggestSeverity(tc: TestCase): { severity: Severity; reason: string } {
  if (tc.outcome === 'flaky') {
    return { severity: 'low', reason: 'Failed, then passed on retry: likely test instability or a timing issue, not a confirmed product defect.' };
  }
  if (tc.tags.includes('@smoke') || tc.tags.includes('@e2e')) {
    return { severity: 'high', reason: 'A @smoke/@e2e test failed consistently: a critical user path is affected.' };
  }
  if (tc.tags.includes('@security')) {
    return { severity: 'high', reason: 'A @security test failed: possible access-control weakness.' };
  }
  return { severity: 'medium', reason: 'A regression test failed consistently.' };
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const shorten = (s: string, max = 80): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function draftBugReport(tc: TestCase, ctx: BugReportContext = {}): BugReport {
  const { expected, actual } = splitExpectation(tc.error);
  const suggested = suggestSeverity(tc);
  const severity = ctx.severity ?? suggested.severity;
  const severityReason = ctx.severity ? 'Set by the reporter.' : suggested.reason;

  const feature = tc.titlePath.length > 1 ? tc.titlePath[0] : tc.file;
  const behaviour = tc.titlePath.at(-1) ?? 'test';
  const title = `[${feature}] ${shorten(behaviour, 70)}: ${shorten(actual.split('\n')[0] ?? actual, 60)}`;

  // Top-level steps only: they are the business actions a human would reproduce.
  const businessSteps = tc.steps.filter((s) => !s.startsWith(' '));
  const reproduce = businessSteps.length
    ? businessSteps.map((s, i) => `${i + 1}. ${s}${tc.failedStep?.startsWith(s) ? ' ← **fails here**' : ''}`)
    : [`1. Run the automated test (see "Reproduce" below). The test records no individual steps.`];

  const envLines = [
    ctx.environment ? `- **Environment:** ${ctx.environment}` : undefined,
    `- **Browser / project:** ${tc.project || 'default'}`,
    ctx.playwrightVersion ? `- **Playwright:** ${ctx.playwrightVersion}` : undefined,
    ctx.runStartedAt ? `- **Run started:** ${ctx.runStartedAt}` : undefined,
    `- **Test:** \`${tc.file}:${tc.line ?? '?'}\`${tc.tags.length ? ` (${tc.tags.join(' ')})` : ''}`,
  ].filter(Boolean);

  const frequency =
    tc.outcome === 'flaky'
      ? `Intermittent: failed on the first attempt, passed on retry (${tc.attempts} attempts).`
      : `Consistent: failed on all ${tc.attempts} attempt${tc.attempts === 1 ? '' : 's'}.`;

  const evidence = tc.attachments.length
    ? tc.attachments.map((a) => `- ${a.name} (${a.contentType})${a.path ? `: \`${a.path}\`` : ''}`)
    : ['- No attachments recorded. Enable `trace`/`screenshot` in playwright.config.ts.'];

  const markdown = [
    `# ${title}`,
    '',
    `**Severity:** ${severity}: ${severityReason}`,
    `**Frequency:** ${frequency}`,
    '',
    '## Environment',
    ...envLines,
    '',
    '## Steps to reproduce',
    ...reproduce,
    '',
    '## Expected result',
    `${capitalise(behaviour)}.`,
    expected ? `Assertion expected: \`${expected}\`` : '',
    '',
    '## Actual result',
    expected ? `Assertion received: \`${actual}\`` : actual,
    tc.failedStep ? `\nFailed at step: _${tc.failedStep}_` : '',
    '',
    '## Evidence',
    ...evidence,
    '',
    '## Reproduce',
    '```bash',
    `npx playwright test ${tc.file}:${tc.line ?? ''} --project=${tc.project || 'chromium'} --trace on`,
    '```',
    '',
    '<details><summary>Full error</summary>',
    '',
    '```',
    tc.error ?? '(none)',
    '```',
    '</details>',
    '',
    '_Drafted by mcp-qa-assistant from the Playwright report. Review before filing._',
  ];

  return { title, severity, severityReason, markdown: markdown.join('\n').replace(/\n{3,}/g, '\n\n') };
}
