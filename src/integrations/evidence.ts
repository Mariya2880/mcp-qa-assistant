import { stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import type { TestCase } from '../report/parse.js';

/** Jira Cloud's default per-file limit is 10 MB; sites can lower it, so stay at or below the default. */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export interface EvidenceFile {
  /** Attachment name from the report, e.g. "screenshot" or "trace". */
  name: string;
  /** File name used for the upload; unique within one issue. */
  fileName: string;
  path: string;
  contentType: string;
  size: number;
}

export interface Evidence {
  files: EvidenceFile[];
  skipped: { name: string; reason: string }[];
}

export const formatSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** "trace.zip", then "trace-2.zip", "trace-3.zip": retries often produce files with the same name. */
function uniqueName(path: string, taken: Set<string>): string {
  const base = basename(path);
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}${ext}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Finds the screenshot, trace and video files a failed test left behind.
 * Relative paths are resolved against the report's folder. Files that are missing, inline-only
 * or too large are skipped with a reason, never silently dropped.
 */
export async function collectEvidence(
  tc: Pick<TestCase, 'attachments'>,
  reportPath: string,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<Evidence> {
  const evidence: Evidence = { files: [], skipped: [] };
  const seen = new Set<string>();
  const names = new Set<string>();

  for (const a of tc.attachments) {
    if (!a.path) {
      evidence.skipped.push({ name: a.name, reason: 'stored inside the report, not as a file' });
      continue;
    }
    const path = isAbsolute(a.path) ? a.path : resolve(dirname(reportPath), a.path);
    if (seen.has(path)) continue;
    seen.add(path);

    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) {
      evidence.skipped.push({ name: a.name, reason: `file not found: ${a.path}` });
    } else if (info.size > maxBytes) {
      evidence.skipped.push({ name: a.name, reason: `${formatSize(info.size)} is over the ${formatSize(maxBytes)} limit` });
    } else {
      evidence.files.push({ name: a.name, fileName: uniqueName(path, names), path, contentType: a.contentType, size: info.size });
    }
  }
  return evidence;
}

/** Human-readable lines for previews and results. */
export function describeEvidence(evidence: Evidence): string[] {
  return [
    ...evidence.files.map((f) => `- ${f.name}: ${f.fileName} (${formatSize(f.size)})`),
    ...evidence.skipped.map((s) => `- ${s.name}: skipped, ${s.reason}`),
  ];
}
