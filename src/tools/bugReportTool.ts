import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { collectTests, findTest, loadReport, ReportError } from '../report/parse.js';
import { draftBugReport } from '../report/bugReport.js';
import { fail, reportPath, text } from './reportTools.js';

export function registerBugReportTool(server: McpServer): void {
  server.registerTool(
    'draft_bug_report',
    {
      title: 'Draft a bug report',
      description:
        'Turns one failed or flaky test from a Playwright JSON report into a structured, ready-to-review bug report ' +
        '(title, severity with reasoning, environment, steps, expected vs actual, evidence, reproduce command) in Markdown.',
      inputSchema: {
        reportPath,
        test: z.string().min(1).describe('Test id from list_failures, or a unique part of the test title'),
        environment: z.string().max(200).optional().describe('Where the run happened, e.g. "staging, build 2026.11.3"'),
        severity: z
          .enum(['critical', 'high', 'medium', 'low'])
          .optional()
          .describe('Override the suggested severity'),
      },
    },
    async ({ reportPath, test, environment, severity }) => {
      try {
        const report = await loadReport(reportPath);
        const found = findTest(collectTests(report), test);
        if (!found.ok) return fail(found.message);

        const tc = found.test;
        if (tc.outcome === 'passed' || tc.outcome === 'skipped') {
          return fail(`"${tc.titlePath.join(' › ')}" ${tc.outcome}: there is no failure to report.`);
        }

        const bug = draftBugReport(tc, {
          environment,
          severity,
          playwrightVersion: report.config?.version,
          runStartedAt: report.stats?.startTime,
        });
        return text(bug.markdown);
      } catch (e) {
        if (e instanceof ReportError) return fail(e.message);
        throw e;
      }
    },
  );
}
