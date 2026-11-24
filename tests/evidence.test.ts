import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectEvidence, describeEvidence, formatSize } from '../src/integrations/evidence.js';
import { JiraError, uploadJiraAttachments } from '../src/integrations/jira.js';
import { connectClient, textOf } from './helpers.js';

const config = { baseUrl: 'https://team.atlassian.net', email: 'qa@example.com', apiToken: 'tkn' };
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A copy of the fixture report in a temp folder, next to the screenshot and trace it points to,
 * so the tests read real files exactly like a user's Playwright output folder.
 */
let dir: string;
let reportPath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qa-evidence-'));
  const source = fileURLToPath(new URL('./fixtures/report.json', import.meta.url));
  reportPath = join(dir, 'report.json');
  await writeFile(reportPath, await readFile(source));
  await mkdir(join(dir, 'test-results/checkout-e2e'), { recursive: true });
  await writeFile(join(dir, 'test-results/checkout-e2e/test-failed-1.png'), Buffer.alloc(2048, 1));
  await writeFile(join(dir, 'test-results/checkout-e2e/trace.zip'), Buffer.alloc(300, 2));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('collectEvidence', () => {
  it('resolves relative paths against the report folder', async () => {
    const evidence = await collectEvidence(
      { attachments: [{ name: 'screenshot', contentType: 'image/png', path: 'test-results/checkout-e2e/test-failed-1.png' }] },
      reportPath,
    );
    expect(evidence.files).toEqual([
      {
        name: 'screenshot',
        fileName: 'test-failed-1.png',
        path: join(dir, 'test-results/checkout-e2e/test-failed-1.png'),
        contentType: 'image/png',
        size: 2048,
      },
    ]);
  });

  it('skips missing, inline and oversized files with a reason', async () => {
    const evidence = await collectEvidence(
      {
        attachments: [
          { name: 'video', contentType: 'video/webm', path: 'test-results/nope/video.webm' },
          { name: 'stdout', contentType: 'text/plain' },
          { name: 'screenshot', contentType: 'image/png', path: join(dir, 'test-results/checkout-e2e/test-failed-1.png') },
        ],
      },
      reportPath,
      1024,
    );
    expect(evidence.files).toEqual([]);
    expect(evidence.skipped.map((s) => s.reason)).toEqual([
      'file not found: test-results/nope/video.webm',
      'stored inside the report, not as a file',
      '2 KB is over the 1 KB limit',
    ]);
  });

  it('uploads each file once and keeps names unique', async () => {
    const trace = { name: 'trace', contentType: 'application/zip', path: 'test-results/checkout-e2e/trace.zip' };
    await mkdir(join(dir, 'retry'), { recursive: true });
    await writeFile(join(dir, 'retry/trace.zip'), 'x');
    const evidence = await collectEvidence(
      { attachments: [trace, trace, { ...trace, path: 'retry/trace.zip' }] },
      reportPath,
    );
    expect(evidence.files.map((f) => f.fileName)).toEqual(['trace.zip', 'trace-2.zip']);
  });

  it('describes files and skips in one list', async () => {
    expect(
      describeEvidence({
        files: [{ name: 'trace', fileName: 'trace.zip', path: '/x', contentType: 'application/zip', size: 300 }],
        skipped: [{ name: 'video', reason: 'file not found: v.webm' }],
      }),
    ).toEqual(['- trace: trace.zip (300 B)', '- video: skipped, file not found: v.webm']);
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('uploadJiraAttachments', () => {
  const file = () => ({
    name: 'trace',
    fileName: 'trace.zip',
    path: join(dir, 'test-results/checkout-e2e/trace.zip'),
    contentType: 'application/zip',
    size: 300,
  });

  it('sends one multipart request with the XSRF header Jira requires', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ id: '1' }]));

    const count = await uploadJiraAttachments('SHOP-7', [file()], config, fetchMock as unknown as typeof fetch);

    expect(count).toBe(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://team.atlassian.net/rest/api/3/issue/SHOP-7/attachments');
    expect(init.headers['X-Atlassian-Token']).toBe('no-check');
    expect(init.headers['Content-Type']).toBeUndefined(); // fetch sets the multipart boundary itself
    const sent = (init.body as FormData).get('file') as File;
    expect(sent.name).toBe('trace.zip');
    expect(sent.size).toBe(300);
  });

  it('does nothing when there are no files', async () => {
    const fetchMock = vi.fn();
    expect(await uploadJiraAttachments('SHOP-7', [], config, fetchMock as unknown as typeof fetch)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid issue key before calling Jira', async () => {
    const fetchMock = vi.fn();
    await expect(
      uploadJiraAttachments('../../admin', [file()], config, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(JiraError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'attachments are disabled'],
    [413, 'attachment limit'],
    [404, 'SHOP-7 was not found'],
  ])('explains HTTP %i in plain words', async (status, message) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(uploadJiraAttachments('SHOP-7', [file()], config, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      message,
    );
  });
});

describe('export_bug_to_jira with evidence', () => {
  const args = () => ({ reportPath, test: 'correct totals', projectKey: 'SHOP' });

  it('lists the files it would attach in the dry run', async () => {
    const client = await connectClient();
    const out = textOf(await client.callTool({ name: 'export_bug_to_jira', arguments: args() }));
    expect(out).toContain('Attachments:\n- screenshot: test-failed-1.png (2 KB)\n- trace: trace.zip (300 B)');
  });

  it('creates the issue, then uploads the screenshot and trace', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ key: 'SHOP-7' }, 201))
      .mockResolvedValueOnce(jsonResponse([{ id: '1' }, { id: '2' }]));
    const client = await connectClient({ jira: { getConfig: () => config, fetchImpl: fetchMock as unknown as typeof fetch } });

    const out = textOf(await client.callTool({ name: 'export_bug_to_jira', arguments: { ...args(), dryRun: false } }));

    expect(out).toBe(
      'Created SHOP-7 in Jira project SHOP: https://team.atlassian.net/browse/SHOP-7\n' +
        'Attached 2 files: test-failed-1.png, trace.zip',
    );
    expect(fetchMock.mock.calls[1]![0]).toBe('https://team.atlassian.net/rest/api/3/issue/SHOP-7/attachments');
  });

  it('keeps the created issue when the upload fails, and says so', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ key: 'SHOP-8' }, 201))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    const client = await connectClient({ jira: { getConfig: () => config, fetchImpl: fetchMock as unknown as typeof fetch } });

    const result = await client.callTool({ name: 'export_bug_to_jira', arguments: { ...args(), dryRun: false } });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Created SHOP-8');
    expect(textOf(result)).toContain('attachments are disabled');
    expect(textOf(result)).toContain('The issue was created without them.');
  });

  it('skips uploads when attachEvidence is false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ key: 'SHOP-9' }, 201));
    const client = await connectClient({ jira: { getConfig: () => config, fetchImpl: fetchMock as unknown as typeof fetch } });

    await client.callTool({ name: 'export_bug_to_jira', arguments: { ...args(), attachEvidence: false, dryRun: false } });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
