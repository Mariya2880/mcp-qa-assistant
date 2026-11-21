import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { collectTests, loadReport, ReportError, type TestCase } from '../report/parse.js';
import { compareRuns } from '../report/compare.js';
import { summariseError } from '../report/bugReport.js';
import { fail, text } from './reportTools.js';

const path = (what: string) => z.string().min(1).describe(`Path to the ${what} Playwright JSON report`);

function line(tc: TestCase): string {
  const err = summariseError(tc.error);
  return `- ${tc.titlePath.join(' › ')} (${tc.project})${err ? `\n  error: ${err}` : ''}`;
}

function section(title: string, tests: TestCase[], withError = true): string {
  if (tests.length === 0) return '';
  const items = tests.map((t) => (withError ? line(t) : `- ${t.titlePath.join(' › ')} (${t.project})`));
  return `\n## ${title} (${tests.length})\n${items.join('\n')}`;
}

export function registerCompareTool(server: McpServer): void {
  server.registerTool(
    'compare_runs',
    {
      title: 'Compare two test runs',
      description:
        'Compares a baseline Playwright JSON report (e.g. last green run or yesterday) with a current one and lists ' +
        'new failures (regressions), fixed tests, tests still failing, newly flaky tests, and added or removed tests. ' +
        'Tests are matched by file, title and project, so moved line numbers do not matter.',
      inputSchema: {
        baselineReportPath: path('baseline (earlier)'),
        currentReportPath: path('current (later)'),
      },
    },
    async ({ baselineReportPath, currentReportPath }) => {
      try {
        const [baseline, current] = await Promise.all([
          loadReport(baselineReportPath).then(collectTests),
          loadReport(currentReportPath).then(collectTests),
        ]);
        const c = compareRuns(baseline, current);

        const verdict =
          c.newFailures.length > 0
            ? `⚠️ ${c.newFailures.length} new failure${c.newFailures.length === 1 ? '' : 's'} since the baseline: start with these.`
            : c.stillFailing.length > 0
              ? `No new failures, but ${c.stillFailing.length} test${c.stillFailing.length === 1 ? ' is' : 's are'} still failing.`
              : 'No new or remaining failures. ✅';

        const body = [
          `Compared ${baseline.length} baseline tests with ${current.length} current tests.`,
          verdict,
          section('New failures', c.newFailures),
          section('Newly flaky', c.newlyFlaky),
          section('Still failing', c.stillFailing),
          section('Fixed', c.fixed, false),
          section('Added tests', c.added, false),
          section('Removed tests', c.removed, false),
        ];
        return text(body.filter(Boolean).join('\n'));
      } catch (e) {
        if (e instanceof ReportError) return fail(e.message);
        throw e;
      }
    },
  );
}
