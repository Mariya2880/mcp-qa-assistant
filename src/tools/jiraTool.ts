import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReportError } from '../report/parse.js';
import {
  buildJiraIssue,
  createJiraIssue,
  JiraError,
  missingConfig,
  PROJECT_KEY_PATTERN,
  uploadJiraAttachments,
  type JiraConfig,
} from '../integrations/jira.js';
import { collectEvidence, describeEvidence, type Evidence } from '../integrations/evidence.js';
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
        'this needs JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN environment variables. ' +
        'By default the screenshot, trace and video files from the report are uploaded as attachments.',
      inputSchema: {
        ...bugInput,
        projectKey: z
          .string()
          .regex(PROJECT_KEY_PATTERN, 'Use the Jira project key, e.g. "SHOP"')
          .describe('Jira project key, e.g. "SHOP"'),
        issueType: z.string().min(1).max(50).default('Bug').describe('Issue type name in that project (default "Bug")'),
        labels: z.array(z.string().min(1).max(50)).max(10).default([]).describe('Extra labels besides "bug" and the severity'),
        attachEvidence: z
          .boolean()
          .default(true)
          .describe('Upload the screenshot, trace and video files from the report (default true)'),
        dryRun: z.boolean().default(true).describe('true (default): preview only. false: create the issue.'),
      },
    },
    async ({ projectKey, issueType, labels, attachEvidence, dryRun, ...bugArgs }) => {
      try {
        const drafted = await draftFromReport(bugArgs);
        if (!drafted.ok) return fail(drafted.message);
        const issue = buildJiraIssue(drafted.bug, projectKey, issueType, labels);
        const { fields } = issue;
        const evidence: Evidence = attachEvidence
          ? await collectEvidence(drafted.test, bugArgs.reportPath)
          : { files: [], skipped: [] };
        const evidenceLines = attachEvidence
          ? ['Attachments:', ...(describeEvidence(evidence).length ? describeEvidence(evidence) : ['- none recorded for this test'])]
          : ['Attachments: not uploaded (attachEvidence: false)'];

        if (dryRun) {
          return text(
            [
              `DRY RUN: nothing was created. This issue would be created in Jira project ${projectKey}:`,
              '',
              `Summary: ${fields.summary}`,
              `Issue type: ${fields.issuetype.name}`,
              `Labels: ${fields.labels.join(', ')}`,
              ...evidenceLines,
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
        const ready = config as Required<JiraConfig>;
        const created = await createJiraIssue(issue, ready, options.fetchImpl);
        const lines = [`Created ${created.key} in Jira project ${projectKey}: ${created.url}`];

        // The issue already exists at this point: a failed upload is reported, not turned into an error.
        if (evidence.files.length) {
          try {
            const count = await uploadJiraAttachments(created.key, evidence.files, ready, options.fetchImpl);
            lines.push(`Attached ${count} file${count === 1 ? '' : 's'}: ${evidence.files.map((f) => f.fileName).join(', ')}`);
          } catch (e) {
            if (!(e instanceof JiraError)) throw e;
            lines.push(`${e.message} The issue was created without them.`);
          }
        }
        if (evidence.skipped.length) {
          lines.push('Not attached:', ...evidence.skipped.map((sk) => `- ${sk.name}: ${sk.reason}`));
        }
        return text(lines.join('\n'));
      } catch (e) {
        if (e instanceof ReportError || e instanceof JiraError) return fail(e.message);
        throw e;
      }
    },
  );
}
