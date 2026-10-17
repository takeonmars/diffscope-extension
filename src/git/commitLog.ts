// Журнал коммитов для окна Git Log: `git log --topo-order` всех веток или одной, порциями,
// с метками веток и тегов у коммитов (%D). Только ветки, удалённые ветки, теги и HEAD — без
// refs/stash и прочих служебных ссылок.
import { LOG_FORMAT, parseLog, type Commit } from './parsers/log';
import { gitText } from './runner';

export type CommitRefKind = 'head' | 'branch' | 'remote' | 'tag';

export interface CommitRef {
  kind: CommitRefKind;
  /** Короткое имя: main, origin/main, v1; у detached HEAD — «HEAD». */
  name: string;
  /** На этой ветке стоит HEAD. */
  current?: boolean;
}

export interface LogCommit extends Commit {
  refs: CommitRef[];
}

export interface CommitLogOptions {
  /** Полное имя ссылки (refs/heads/main) или хеш; не задано — все ветки, удалённые и теги. */
  ref?: string;
  skip?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface CommitLogPage {
  commits: LogCommit[];
  /** Есть ещё коммиты дальше этой порции. */
  hasMore: boolean;
}

const FORMAT = `${LOG_FORMAT}%x00%D`;
const FIELDS = 8;

export async function commitLog(
  root: string,
  { ref, skip = 0, limit = 500, signal }: CommitLogOptions = {},
): Promise<CommitLogPage> {
  const revs = ref ? [ref] : ['--branches', '--remotes', '--tags', 'HEAD'];
  const out = await gitText(
    [
      'log',
      '-z',
      '--topo-order',
      '--decorate=full',
      '--no-color',
      FORMAT,
      `--skip=${skip}`,
      // На один больше — узнать, есть ли продолжение.
      `-n${limit + 1}`,
      ...revs,
      '--',
    ],
    // 128 — пустой репозиторий (нет HEAD).
    { cwd: root, signal, timeout: 120_000, okCodes: [0, 128] },
  );
  const commits = parseCommitLog(out);
  return { commits: commits.slice(0, limit), hasMore: commits.length > limit };
}

export function parseCommitLog(output: string): LogCommit[] {
  const parts = output.split('\0');
  const commits: LogCommit[] = [];
  for (let i = 0; i + FIELDS <= parts.length; i += FIELDS) {
    const fields = parts.slice(i, i + FIELDS);
    const [commit] = parseLog(`${fields.slice(0, FIELDS - 1).join('\0')}\0`);
    if (commit) commits.push({ ...commit, refs: parseDecorations(fields[FIELDS - 1]) });
  }
  return commits;
}

/** «HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main» → метки. */
export function parseDecorations(text: string): CommitRef[] {
  const refs: CommitRef[] = [];
  for (const raw of text.split(', ')) {
    const item = raw.trim();
    if (!item) continue;
    if (item === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' });
      continue;
    }
    const pointsAt = item.startsWith('HEAD -> ') ? item.slice('HEAD -> '.length) : undefined;
    const full = pointsAt ?? (item.startsWith('tag: ') ? item.slice('tag: '.length) : item);
    if (full.startsWith('refs/heads/')) {
      refs.push({
        kind: 'branch',
        name: full.slice(11),
        current: pointsAt !== undefined || undefined,
      });
    } else if (full.startsWith('refs/remotes/')) {
      // origin/HEAD — указатель на ветку по умолчанию, не отдельная ветка.
      if (!full.endsWith('/HEAD')) refs.push({ kind: 'remote', name: full.slice(13) });
    } else if (full.startsWith('refs/tags/')) {
      refs.push({ kind: 'tag', name: full.slice(10) });
    }
  }
  return refs;
}
