import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReportError } from '../report/parse.js';
import {
  buildJiraIssue,
  createJiraIssue,
  JiraError,
  missingConfig,
  PROJECT_KEY_PATTERN,
  type JiraConfig,
} from '../integrations/jira.js';
import { bugInput, draftFromReport } from './bugReportTool.js';
import { fail, text } from './reportTools.js';

export interface JiraOptions {
  /** Read at call time so credentials never appear in tool arguments or logs. */
  getConfig?: () => JiraConfig;
  fetchImpl?: typeof fetch;
}

const fromEnv = (): JiraConfig => ({
  baseUrl: process.env.JIRA_BASE_URL,
  email: process.env.JIRA_EMAIL,
  apiToken: process.env.JIRA_API_TOKEN,
});

export function registerJiraTool(server: McpServer, options: JiraOptions = {}): void {
  const getConfig = options.getConfig ?? fromEnv;

  server.registerTool(
    'export_bug_to_jira',
    {
      title: 'Export a bug report to Jira',
      description:
        'Drafts a bug report for one failed or flaky test and turns it into a Jira issue. ' +
        'DRY RUN BY DEFAULT: returns the exact issue that would be created. Set dryRun to false to create it; ' +
        'this needs JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN environment variables.',
      inputSchema: {
        ...bugInput,
        projectKey: z
          .string()
          .regex(PROJECT_KEY_PATTERN, 'Use the Jira project key, e.g. "SHOP"')
          .describe('Jira project key, e.g. "SHOP"'),
        issueType: z.string().min(1).max(50).default('Bug').describe('Issue type name in that project (default "Bug")'),
        labels: z.array(z.string().min(1).max(50)).max(10).default([]).describe('Extra labels besides "bug" and the severity'),
        dryRun: z.boolean().default(true).describe('true (default): preview only. false: create the issue.'),
      },
    },
    async ({ projectKey, issueType, labels, dryRun, ...bugArgs }) => {
      try {
        const drafted = await draftFromReport(bugArgs);
        if (!drafted.ok) return fail(drafted.message);
        const issue = buildJiraIssue(drafted.bug, projectKey, issueType, labels);
        const { fields } = issue;

        if (dryRun) {
          return text(
            [
              `DRY RUN: nothing was created. This issue would be created in Jira project ${projectKey}:`,
              '',
              `Summary: ${fields.summary}`,
              `Issue type: ${fields.issuetype.name}`,
              `Labels: ${fields.labels.join(', ')}`,
              '',
              'Description (sent to Jira as Atlassian Document Format):',
              '',
              drafted.bug.markdown.replace(/^# .*\n+/, ''),
              '',
              'To create it, call again with dryRun: false (requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).',
            ].join('\n'),
          );
        }

        const config = getConfig();
        const missing = missingConfig(config);
        if (missing.length) {
          return fail(`${missing.join(', ')} not set. Add them to the server environment, or keep dryRun: true to preview only.`);
        }
        const created = await createJiraIssue(issue, config as Required<JiraConfig>, options.fetchImpl);
        return text(`Created ${created.key} in Jira project ${projectKey}: ${created.url}`);
      } catch (e) {
        if (e instanceof ReportError || e instanceof JiraError) return fail(e.message);
        throw e;
      }
    },
  );
}
