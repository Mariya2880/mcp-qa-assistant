import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { collectTests, loadReport } from '../src/report/parse.js';
import { draftBugReport } from '../src/report/bugReport.js';
import { buildIssue, createIssue, GitHubError } from '../src/integrations/github.js';
import { connectClient, textOf } from './helpers.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const failedBug = async () => draftBugReport(collectTests(await loadReport(fixture('report.json')))[0]!);

const okResponse = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('buildIssue', () => {
  it('uses the bug title, drops the duplicate heading and labels by severity', async () => {
    const issue = buildIssue(await failedBug(), ['checkout', 'bug']);
    expect(issue.title).toMatch(/^\[End-to-end purchase\]/);
    expect(issue.body.startsWith('# ')).toBe(false);
    expect(issue.body).toContain('**Severity:** high');
    expect(issue.labels).toEqual(['bug', 'severity:high', 'checkout']);
  });
});

describe('createIssue', () => {
  it('posts to the GitHub issues API with the right headers and returns the issue link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ number: 42, html_url: 'https://github.com/o/r/issues/42' }));
    const issue = buildIssue(await failedBug());

    const created = await createIssue('o/r', issue, 'tkn', fetchMock as unknown as typeof fetch);

    expect(created).toEqual({ number: 42, url: 'https://github.com/o/r/issues/42' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/o/r/issues');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tkn');
    expect(JSON.parse(init.body)).toEqual(issue);
  });

  it.each([
    [401, 'token was rejected'],
    [403, 'lacks permission'],
    [404, 'not found'],
    [410, 'issues are disabled'],
    [500, 'HTTP 500'],
  ])('explains HTTP %i in plain words', async (status, message) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(
      createIssue('o/r', buildIssue(await failedBug()), 'tkn', fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(message);
  });

  it('rejects an invalid repository name before calling the API', async () => {
    const fetchMock = vi.fn();
    await expect(
      createIssue('not a repo', buildIssue(await failedBug()), 'tkn', fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(GitHubError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('export_bug_to_github over MCP', () => {
  const args = { reportPath: fixture('report.json'), test: 'correct totals', repo: 'o/r' };

  it('is a dry run by default and never calls GitHub', async () => {
    const fetchMock = vi.fn();
    const client = await connectClient({ export: { getToken: () => 'tkn', fetchImpl: fetchMock as unknown as typeof fetch } });

    const out = textOf(await client.callTool({ name: 'export_bug_to_github', arguments: args }));

    expect(out).toContain('DRY RUN: nothing was created. This issue would be opened in o/r:');
    expect(out).toContain('Labels: bug, severity:high');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates the issue when dryRun is false and a token is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ number: 7, html_url: 'https://github.com/o/r/issues/7' }));
    const client = await connectClient({ export: { getToken: () => 'tkn', fetchImpl: fetchMock as unknown as typeof fetch } });

    const out = textOf(await client.callTool({ name: 'export_bug_to_github', arguments: { ...args, dryRun: false } }));

    expect(out).toBe('Created issue #7 in o/r: https://github.com/o/r/issues/7');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses to create without a token', async () => {
    const fetchMock = vi.fn();
    const client = await connectClient({ export: { getToken: () => undefined, fetchImpl: fetchMock as unknown as typeof fetch } });

    const result = await client.callTool({ name: 'export_bug_to_github', arguments: { ...args, dryRun: false } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('GITHUB_TOKEN is not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a GitHub error into a readable tool error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
    const client = await connectClient({ export: { getToken: () => 'tkn', fetchImpl: fetchMock as unknown as typeof fetch } });

    const result = await client.callTool({ name: 'export_bug_to_github', arguments: { ...args, dryRun: false } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('lacks permission');
  });

  it('validates the repository format', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'export_bug_to_github', arguments: { ...args, repo: 'just-a-name' } });
    expect(result.isError).toBe(true);
  });

  it('will not export a passing test', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'export_bug_to_github',
      arguments: { ...args, test: 'same name and price' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('no failure to report');
  });
});
