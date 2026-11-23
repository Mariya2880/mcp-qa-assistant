import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { collectTests, loadReport } from '../src/report/parse.js';
import { draftBugReport } from '../src/report/bugReport.js';
import { inline, markdownToAdf } from '../src/integrations/adf.js';
import { buildJiraIssue, createJiraIssue, JiraError, missingConfig } from '../src/integrations/jira.js';
import { connectClient, textOf } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const failedBug = async () => draftBugReport(collectTests(await loadReport(fixture('report.json')))[0]!);

const config = { baseUrl: 'https://team.atlassian.net', email: 'qa@example.com', apiToken: 'tkn' };
const jsonResponse = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('markdownToAdf', () => {
  it('turns bold, code and italic into ADF marks', () => {
    expect(inline('**Severity:** high, see `a_b.ts` and _step_')).toEqual([
      { type: 'text', text: 'Severity:', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' high, see ' },
      { type: 'text', text: 'a_b.ts', marks: [{ type: 'code' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'step', marks: [{ type: 'em' }] },
    ]);
  });

  it('leaves underscores inside words alone', () => {
    expect(inline('problem_user_flow')).toEqual([{ type: 'text', text: 'problem_user_flow' }]);
  });

  it('builds headings, bullet lists, numbered lists and code blocks', () => {
    const doc = markdownToAdf(['## Steps', '1. open', '2. pay', '', '- a', '- b', '```bash', 'npx playwright test', '```'].join('\n'));
    expect(doc.type).toBe('doc');
    expect(doc.version).toBe(1);
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'orderedList', 'bulletList', 'codeBlock']);
    expect(doc.content[1]!.content).toHaveLength(2);
    expect(doc.content[3]).toEqual({
      type: 'codeBlock',
      attrs: { language: 'bash' },
      content: [{ type: 'text', text: 'npx playwright test' }],
    });
  });

  it('keeps the <details> summary as a heading and drops the HTML tags', () => {
    const doc = markdownToAdf(['<details><summary>Full error</summary>', '', '```', 'boom', '```', '</details>'].join('\n'));
    expect(doc.content.map((n) => n.type)).toEqual(['heading', 'codeBlock']);
    expect(JSON.stringify(doc)).not.toContain('<details>');
  });

  it('never produces empty text nodes', () => {
    const doc = markdownToAdf('```\n```\n\n**x**');
    expect(JSON.stringify(doc)).not.toContain('"text":""');
  });
});

describe('buildJiraIssue', () => {
  it('maps the bug onto Jira fields with severity as a label', async () => {
    const { fields } = buildJiraIssue(await failedBug(), 'SHOP', 'Bug', ['checkout flow', 'bug']);
    expect(fields.project).toEqual({ key: 'SHOP' });
    expect(fields.issuetype).toEqual({ name: 'Bug' });
    expect(fields.summary).toMatch(/^\[End-to-end purchase\]/);
    expect(fields.labels).toEqual(['bug', 'severity-high', 'checkout-flow']);
    expect(fields.description.type).toBe('doc');
  });

  it('does not repeat the title as the first heading of the description', async () => {
    const { fields } = buildJiraIssue(await failedBug(), 'SHOP');
    expect(fields.description.content[0]!.type).toBe('paragraph');
  });

  it('keeps the summary within Jira\'s 255-character limit', async () => {
    const bug = { ...(await failedBug()), title: 'x'.repeat(400) };
    expect(buildJiraIssue(bug, 'SHOP').fields.summary).toHaveLength(255);
  });
});

describe('createJiraIssue', () => {
  it('posts to the Jira v3 API with basic auth and returns the browse link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: '10001', key: 'SHOP-12' }));
    const issue = buildJiraIssue(await failedBug(), 'SHOP');

    const created = await createJiraIssue(issue, config, fetchMock as unknown as typeof fetch);

    expect(created).toEqual({ key: 'SHOP-12', url: 'https://team.atlassian.net/browse/SHOP-12' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://team.atlassian.net/rest/api/3/issue');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('qa@example.com:tkn').toString('base64')}`);
    expect(JSON.parse(init.body)).toEqual(issue);
  });

  it('ignores a trailing path on the site URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ key: 'SHOP-1' }));
    await createJiraIssue(buildJiraIssue(await failedBug(), 'SHOP'), { ...config, baseUrl: 'https://team.atlassian.net/jira/' }, fetchMock as unknown as typeof fetch);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://team.atlassian.net/rest/api/3/issue');
  });

  it('passes on Jira\'s field-level reasons for a 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ errorMessages: [], errors: { issuetype: 'Specify a valid issue type' } }, 400),
    );
    await expect(
      createJiraIssue(buildJiraIssue(await failedBug(), 'SHOP'), config, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow('issuetype: Specify a valid issue type');
  });

  it.each([
    [401, 'credentials were rejected'],
    [403, 'may not create issues'],
    [404, 'not found'],
    [500, 'HTTP 500'],
  ])('explains HTTP %i in plain words', async (status, message) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(
      createJiraIssue(buildJiraIssue(await failedBug(), 'SHOP'), config, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(message);
  });

  it.each(['not a url', 'http://team.atlassian.net'])('refuses the site URL "%s" before calling Jira', async (baseUrl) => {
    const fetchMock = vi.fn();
    await expect(
      createJiraIssue(buildJiraIssue(await failedBug(), 'SHOP'), { ...config, baseUrl }, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(JiraError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('missingConfig', () => {
  it('names every missing environment variable', () => {
    expect(missingConfig({})).toEqual(['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN']);
    expect(missingConfig(config)).toEqual([]);
  });
});

describe('export_bug_to_jira over MCP', () => {
  const args = { reportPath: fixture('report.json'), test: 'correct totals', projectKey: 'SHOP' };

  it('is a dry run by default and never calls Jira', async () => {
    const fetchMock = vi.fn();
    const client = await connectClient({ jira: { getConfig: () => config, fetchImpl: fetchMock as unknown as typeof fetch } });

    const out = textOf(await client.callTool({ name: 'export_bug_to_jira', arguments: args }));

    expect(out).toContain('DRY RUN: nothing was created. This issue would be created in Jira project SHOP:');
    expect(out).toContain('Issue type: Bug');
    expect(out).toContain('Labels: bug, severity-high');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates the issue when dryRun is false and Jira is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ key: 'SHOP-7' }));
    const client = await connectClient({ jira: { getConfig: () => config, fetchImpl: fetchMock as unknown as typeof fetch } });

    const out = textOf(
      await client.callTool({ name: 'export_bug_to_jira', arguments: { ...args, issueType: 'Defect', dryRun: false } }),
    );

    expect(out).toBe('Created SHOP-7 in Jira project SHOP: https://team.atlassian.net/browse/SHOP-7');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).fields.issuetype).toEqual({ name: 'Defect' });
  });

  it('lists the missing settings instead of calling Jira', async () => {
    const fetchMock = vi.fn();
    const client = await connectClient({
      jira: { getConfig: () => ({ baseUrl: config.baseUrl }), fetchImpl: fetchMock as unknown as typeof fetch },
    });

    const result = await client.callTool({ name: 'export_bug_to_jira', arguments: { ...args, dryRun: false } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('JIRA_EMAIL, JIRA_API_TOKEN not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a Jira error into a readable tool error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    const client = await connectClient({ jira: { getConfig: () => config, fetchImpl: fetchMock as unknown as typeof fetch } });

    const result = await client.callTool({ name: 'export_bug_to_jira', arguments: { ...args, dryRun: false } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('credentials were rejected');
  });

  it('validates the project key', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'export_bug_to_jira', arguments: { ...args, projectKey: 'shop' } });
    expect(result.isError).toBe(true);
  });

  it('will not export a passing test', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'export_bug_to_jira',
      arguments: { ...args, test: 'same name and price' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('no failure to report');
  });
});
