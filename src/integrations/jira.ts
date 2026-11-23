import type { BugReport } from '../report/bugReport.js';
import { markdownToAdf, type AdfDoc } from './adf.js';

export interface JiraConfig {
  /** Site URL, e.g. https://your-team.atlassian.net */
  baseUrl?: string;
  email?: string;
  apiToken?: string;
}

export interface JiraIssuePayload {
  fields: {
    project: { key: string };
    issuetype: { name: string };
    summary: string;
    description: AdfDoc;
    labels: string[];
  };
}

export interface CreatedJiraIssue {
  key: string;
  url: string;
}

export class JiraError extends Error {}

/** Jira project keys: an uppercase letter, then uppercase letters, digits or underscores. */
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,9}$/;

/** Jira rejects labels that contain spaces. */
const toLabel = (s: string): string => s.trim().replace(/\s+/g, '-');

/**
 * Maps a drafted bug onto a Jira issue.
 * Severity becomes a label rather than the Priority field, because Priority is often missing from
 * a project's create screen and would make the whole request fail.
 */
export function buildJiraIssue(
  bug: BugReport,
  projectKey: string,
  issueType = 'Bug',
  extraLabels: string[] = [],
): JiraIssuePayload {
  const labels = [...new Set(['bug', `severity-${bug.severity}`, ...extraLabels.map(toLabel)].filter(Boolean))];
  const body = bug.markdown.replace(/^# .*\n+/, '');
  return {
    fields: {
      project: { key: projectKey },
      issuetype: { name: issueType },
      summary: bug.title.length > 255 ? `${bug.title.slice(0, 254)}…` : bug.title,
      description: markdownToAdf(body),
      labels,
    },
  };
}

/** Returns the names of the environment variables that still need a value. */
export function missingConfig(config: JiraConfig): string[] {
  return [
    config.baseUrl ? undefined : 'JIRA_BASE_URL',
    config.email ? undefined : 'JIRA_EMAIL',
    config.apiToken ? undefined : 'JIRA_API_TOKEN',
  ].filter((v): v is string => Boolean(v));
}

function siteUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new JiraError(`JIRA_BASE_URL "${baseUrl}" is not a valid URL.`);
  }
  if (url.protocol !== 'https:') throw new JiraError('JIRA_BASE_URL must use https.');
  return url.origin;
}

/** Jira answers 400 with field-level reasons; surface them, they usually name the exact fix. */
async function badRequestDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
    const parts = [
      ...(data.errorMessages ?? []),
      ...Object.entries(data.errors ?? {}).map(([field, msg]) => `${field}: ${msg}`),
    ];
    return parts.length ? parts.join('; ') : 'Jira rejected the request';
  } catch {
    return 'Jira rejected the request';
  }
}

/**
 * Creates the issue through the Jira Cloud REST API v3 (basic auth with an API token).
 * `fetchImpl` is injectable so tests never call a real Jira site.
 */
export async function createJiraIssue(
  issue: JiraIssuePayload,
  config: Required<JiraConfig>,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedJiraIssue> {
  const site = siteUrl(config.baseUrl);
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');

  const res = await fetchImpl(`${site}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(issue),
  });

  if (!res.ok) {
    const reason =
      res.status === 400
        ? await badRequestDetail(res)
        : res.status === 401
          ? 'the credentials were rejected (check JIRA_EMAIL and JIRA_API_TOKEN)'
          : res.status === 403
            ? 'this account may not create issues in the project'
            : res.status === 404
              ? 'the Jira site or project was not found'
              : `Jira returned HTTP ${res.status}`;
    throw new JiraError(`Could not create the Jira issue: ${reason}.`);
  }

  const data = (await res.json()) as { key: string };
  return { key: data.key, url: `${site}/browse/${data.key}` };
}
