import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReportError } from '../report/parse.js';
import { buildIssue, createIssue, GitHubError, REPO_PATTERN } from '../integrations/github.js';
import { bugInput, draftFromReport } from './bugReportTool.js';
import { fail, text } from './reportTools.js';

export interface ExportOptions {
  /** Read at call time so the token never appears in tool arguments or logs. */
  getToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export function registerExportTool(server: McpServer, options: ExportOptions = {}): void {
  const getToken = options.getToken ?? (() => process.env.GITHUB_TOKEN);

  server.registerTool(
    'export_bug_to_github',
    {
      title: 'Export a bug report to GitHub Issues',
      description:
        'Drafts a bug report for one failed or flaky test and turns it into a GitHub issue. ' +
        'DRY RUN BY DEFAULT: returns the exact issue that would be created. Set dryRun to false to create it; ' +
        'this needs a GITHUB_TOKEN environment variable with permission to create issues.',
      inputSchema: {
        ...bugInput,
        repo: z.string().regex(REPO_PATTERN, 'Use the form owner/name').describe('Target repository, e.g. "my-org/web-app"'),
        labels: z.array(z.string().min(1).max(50)).max(10).default([]).describe('Extra labels besides "bug" and the severity'),
        dryRun: z.boolean().default(true).describe('true (default): preview only. false: create the issue.'),
      },
    },
    async ({ repo, labels, dryRun, ...bugArgs }) => {
      try {
        const drafted = await draftFromReport(bugArgs);
        if (!drafted.ok) return fail(drafted.message);
        const issue = buildIssue(drafted.bug, labels);

        if (dryRun) {
          return text(
            [
              `DRY RUN: nothing was created. This issue would be opened in ${repo}:`,
              '',
              `Title: ${issue.title}`,
              `Labels: ${issue.labels.join(', ')}`,
              '',
              issue.body,
              '',
              'To create it, call again with dryRun: false (requires GITHUB_TOKEN).',
            ].join('\n'),
          );
        }

        const token = getToken();
        if (!token) {
          return fail('GITHUB_TOKEN is not set. Add it to the server environment, or keep dryRun: true to preview only.');
        }
        const created = await createIssue(repo, issue, token, options.fetchImpl);
        return text(`Created issue #${created.number} in ${repo}: ${created.url}`);
      } catch (e) {
        if (e instanceof ReportError || e instanceof GitHubError) return fail(e.message);
        throw e;
      }
    },
  );
}
