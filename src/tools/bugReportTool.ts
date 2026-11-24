import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { collectTests, findTest, loadReport, ReportError, type TestCase } from '../report/parse.js';
import { draftBugReport, type BugReport, type Severity } from '../report/bugReport.js';
import { fail, reportPath, text } from './reportTools.js';

/** Input fields shared by every tool that starts from "one test in one report". */
export const bugInput = {
  reportPath,
  test: z.string().min(1).describe('Test id from list_failures, or a unique part of the test title'),
  environment: z.string().max(200).optional().describe('Where the run happened, e.g. "staging, build 2026.11.3"'),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Override the suggested severity'),
};

/** Loads the report, finds the test and drafts the bug, or returns a user-facing error message. */
export async function draftFromReport(args: {
  reportPath: string;
  test: string;
  environment?: string;
  severity?: Severity;
}): Promise<{ ok: true; bug: BugReport; test: TestCase } | { ok: false; message: string }> {
  const report = await loadReport(args.reportPath);
  const found = findTest(collectTests(report), args.test);
  if (!found.ok) return found;

  const tc = found.test;
  if (tc.outcome === 'passed' || tc.outcome === 'skipped') {
    return { ok: false, message: `"${tc.titlePath.join(' › ')}" ${tc.outcome}: there is no failure to report.` };
  }
  return {
    ok: true,
    test: tc,
    bug: draftBugReport(tc, {
      environment: args.environment,
      severity: args.severity,
      playwrightVersion: report.config?.version,
      runStartedAt: report.stats?.startTime,
    }),
  };
}

export function registerBugReportTool(server: McpServer): void {
  server.registerTool(
    'draft_bug_report',
    {
      title: 'Draft a bug report',
      description:
        'Turns one failed or flaky test from a Playwright JSON report into a structured, ready-to-review bug report ' +
        '(title, severity with reasoning, environment, steps, expected vs actual, evidence, reproduce command) in Markdown.',
      inputSchema: bugInput,
    },
    async (args) => {
      try {
        const drafted = await draftFromReport(args);
        return drafted.ok ? text(drafted.bug.markdown) : fail(drafted.message);
      } catch (e) {
        if (e instanceof ReportError) return fail(e.message);
        throw e;
      }
    },
  );
}
