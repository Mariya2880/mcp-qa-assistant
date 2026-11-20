import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { collectTests, findTest, loadReport, ReportError, type TestCase } from '../report/parse.js';
import { summariseError } from '../report/bugReport.js';

export const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
export const fail = (t: string) => ({ ...text(t), isError: true });

export const reportPath = z
  .string()
  .min(1)
  .describe('Path to a Playwright JSON report, e.g. ./report.json (npx playwright test --reporter=json > report.json)');

function oneLine(tc: TestCase): string {
  const err = summariseError(tc.error);
  return `- [${tc.outcome.toUpperCase()}] ${tc.titlePath.join(' › ')} (${tc.project}, ${tc.attempts} attempt${tc.attempts === 1 ? '' : 's'})` +
    `\n  id: ${tc.id}` + (err ? `\n  error: ${err}` : '');
}

export function registerReportTools(server: McpServer): void {
  server.registerTool(
    'list_failures',
    {
      title: 'List failed and flaky tests',
      description:
        'Reads a Playwright JSON report and returns a summary plus every failed and flaky test, ' +
        'with its id (for get_failure_details) and the first line of its error.',
      inputSchema: {
        reportPath,
        includeFlaky: z.boolean().default(true).describe('Also list tests that failed first and passed on retry'),
      },
    },
    async ({ reportPath, includeFlaky }) => {
      try {
        const tests = collectTests(await loadReport(reportPath));
        const count = (o: TestCase['outcome']) => tests.filter((t) => t.outcome === o).length;
        const relevant = tests.filter((t) => t.outcome === 'failed' || (includeFlaky && t.outcome === 'flaky'));

        const summary =
          `Report: ${tests.length} tests: ${count('passed')} passed, ${count('failed')} failed, ` +
          `${count('flaky')} flaky, ${count('skipped')} skipped.`;
        if (relevant.length === 0) return text(`${summary}\nNo failures. 🎉`);
        return text(`${summary}\n\n${relevant.map(oneLine).join('\n')}`);
      } catch (e) {
        if (e instanceof ReportError) return fail(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    'get_failure_details',
    {
      title: 'Get details of one test',
      description:
        'Returns the full error, the step where it failed, all steps, annotations and attachment paths ' +
        '(trace, screenshot, video) for one test. Use the id from list_failures, or any unique part of the test title.',
      inputSchema: {
        reportPath,
        test: z.string().min(1).describe('Test id from list_failures, or a unique part of the test title'),
      },
    },
    async ({ reportPath, test }) => {
      try {
        const found = findTest(collectTests(await loadReport(reportPath)), test);
        if (!found.ok) return fail(found.message);
        const tc = found.test;
        const lines = [
          `# ${tc.titlePath.join(' › ')}`,
          `Outcome: ${tc.outcome} · Project: ${tc.project} · Attempts: ${tc.attempts} · Duration: ${tc.durationMs} ms`,
          `Location: ${tc.file}:${tc.line ?? '?'}`,
          tc.tags.length ? `Tags: ${tc.tags.join(', ')}` : '',
          tc.failedStep ? `Failed at step: ${tc.failedStep}` : '',
          '',
          '## Error',
          tc.error ?? '(no error recorded)',
          '',
          '## Steps',
          tc.steps.length ? tc.steps.join('\n') : '(no steps recorded)',
          tc.annotations.length ? `\n## Annotations\n${tc.annotations.map((a) => `- ${a.type}: ${a.description ?? ''}`).join('\n')}` : '',
          tc.attachments.length
            ? `\n## Attachments\n${tc.attachments.map((a) => `- ${a.name} (${a.contentType})${a.path ? `: ${a.path}` : ''}`).join('\n')}`
            : '',
        ];
        return text(lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n').trim());
      } catch (e) {
        if (e instanceof ReportError) return fail(e.message);
        throw e;
      }
    },
  );
}
