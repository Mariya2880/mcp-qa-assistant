import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { collectTests, loadReport, ReportError } from '../report/parse.js';
import { buildHistory, type TestHistory } from '../report/history.js';
import { fail, text } from './reportTools.js';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const row = (h: TestHistory) =>
  `- ${h.test.titlePath.join(' › ')} (${h.test.project})\n  ${h.timeline}  ·  unstable in ${h.flaky + h.failed}/${h.runs} runs (${pct(h.instability)}): ${h.flaky} flaky, ${h.failed} failed`;

export function registerHistoryTool(server: McpServer): void {
  server.registerTool(
    'flaky_history',
    {
      title: 'Rank unstable tests across runs',
      description:
        'Reads several Playwright JSON reports (oldest first) and ranks tests by how often they flaked or failed while ' +
        'also passing in other runs. Shows a per-run timeline (✓ passed, ~ flaky, ✗ failed, - not run). Tests that failed ' +
        'in every run are listed separately as consistent failures.',
      inputSchema: {
        reportPaths: z
          .array(z.string().min(1))
          .min(2)
          .max(30)
          .describe('Paths to Playwright JSON reports, oldest first (at least 2)'),
        top: z.number().int().min(1).max(50).default(10).describe('How many unstable tests to list'),
      },
    },
    async ({ reportPaths, top }) => {
      try {
        const runs = await Promise.all(reportPaths.map((p) => loadReport(p).then(collectTests)));
        const { unstable, alwaysFailing } = buildHistory(runs);

        const lines = [
          `Analysed ${runs.length} runs. Timeline is oldest → newest (✓ passed, ~ flaky, ✗ failed, - not run).`,
          unstable.length
            ? `\n## Unstable tests (${unstable.length}${unstable.length > top ? `, top ${top} shown` : ''})\n${unstable.slice(0, top).map(row).join('\n')}`
            : '\nNo unstable tests: every test either passed cleanly or failed consistently. ✅',
          alwaysFailing.length ? `\n## Failing in every run (${alwaysFailing.length})\n${alwaysFailing.map(row).join('\n')}` : '',
        ];
        return text(lines.filter(Boolean).join('\n'));
      } catch (e) {
        if (e instanceof ReportError) return fail(e.message);
        throw e;
      }
    },
  );
}
