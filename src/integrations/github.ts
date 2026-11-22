import type { BugReport } from '../report/bugReport.js';

export interface IssuePayload {
  title: string;
  body: string;
  labels: string[];
}

export interface CreatedIssue {
  number: number;
  url: string;
}

export class GitHubError extends Error {}

export const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** Maps a drafted bug onto a GitHub issue; severity becomes a label so issues can be filtered. */
export function buildIssue(bug: BugReport, extraLabels: string[] = []): IssuePayload {
  const labels = [...new Set(['bug', `severity:${bug.severity}`, ...extraLabels])];
  // The Markdown already starts with "# <title>"; GitHub shows the title separately, so drop the duplicate heading.
  const body = bug.markdown.replace(/^# .*\n+/, '');
  return { title: bug.title, body, labels };
}

/**
 * Creates the issue through the GitHub REST API.
 * `fetchImpl` is injectable so tests never call the real API.
 */
export async function createIssue(
  repo: string,
  issue: IssuePayload,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedIssue> {
  if (!REPO_PATTERN.test(repo)) throw new GitHubError(`"${repo}" is not a valid "owner/name" repository.`);

  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(issue),
  });

  if (!res.ok) {
    const reason =
      res.status === 401
        ? 'the token was rejected (check GITHUB_TOKEN)'
        : res.status === 403
          ? 'the token lacks permission to create issues in this repository'
          : res.status === 404
            ? 'the repository was not found or the token cannot see it'
            : res.status === 410
              ? 'issues are disabled in this repository'
              : `GitHub returned HTTP ${res.status}`;
    throw new GitHubError(`Could not create the issue: ${reason}.`);
  }

  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}
