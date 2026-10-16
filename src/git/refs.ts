// Ревизии для выбора: ветки, теги, HEAD, недавние коммиты, поиск коммитов.
import { LOG_FORMAT, parseLog, type Commit } from './parsers/log';
import { GitError, gitText } from './runner';

export type RefKind = 'branch' | 'remote' | 'tag';

export interface Ref {
  kind: RefKind;
  /** Короткое имя: main, origin/main, v1.0. */
  name: string;
  /** Полное имя: refs/heads/main. */
  fullName: string;
  /** Коммит (у аннотированного тега — коммит, на который он указывает). */
  commit: string;
  subject: string;
}

export interface Head {
  /** undefined — в репозитории ещё нет коммитов. */
  commit?: string;
  /** Текущая ветка; undefined — detached HEAD. */
  branch?: string;
}

const PREFIXES: [string, RefKind][] = [
  ['refs/heads/', 'branch'],
  ['refs/remotes/', 'remote'],
  ['refs/tags/', 'tag'],
];

export async function listRefs(root: string, signal?: AbortSignal): Promise<Ref[]> {
  const out = await gitText(
    [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(subject)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ],
    { cwd: root, signal },
  );
  return parseRefs(out);
}

export function parseRefs(output: string): Ref[] {
  const refs: Ref[] = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const [fullName, object, peeled, subject] = line.split('\0');
    const prefix = PREFIXES.find(([p]) => fullName.startsWith(p));
    // refs/remotes/origin/HEAD — ссылка на ветку по умолчанию, не отдельная ветка.
    if (!prefix || (prefix[1] === 'remote' && fullName.endsWith('/HEAD'))) continue;
    refs.push({
      kind: prefix[1],
      name: fullName.slice(prefix[0].length),
      fullName,
      commit: peeled || object,
      subject: subject ?? '',
    });
  }
  return refs;
}

export async function getHead(root: string, signal?: AbortSignal): Promise<Head> {
  const [commit, branch] = await Promise.all([
    gitText(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root, signal, okCodes: [0, 1] }),
    gitText(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, signal, okCodes: [0, 1] }),
  ]);
  return { commit: commit.trim() || undefined, branch: branch.trim() || undefined };
}

/** Последние коммиты текущей ветки (для выбора ревизии); в пустом репозитории — []. */
export async function recentCommits(
  root: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<Commit[]> {
  const head = await getHead(root, signal);
  return head.commit ? log(root, [`-n${limit}`, head.commit], signal) : [];
}

/** Сколько последних коммитов просматривать при поиске не-ASCII текста. */
const UNICODE_SEARCH_DEPTH = 20_000;

/**
 * Поиск коммитов: по началу хеша (от 4 символов) и по тексту сообщения во всех ветках,
 * без учёта регистра. Сначала — совпадение по хешу.
 */
export async function searchCommits(
  root: string,
  query: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<Commit[]> {
  const q = query.trim();
  if (!q) return [];
  const byHash = /^[0-9a-f]{4,40}$/i.test(q) ? resolveCommit(root, q, signal) : undefined;
  const [hashCommit, messageCommits] = await Promise.all([
    byHash,
    searchMessages(root, q, limit, signal),
  ]);
  const result = hashCommit ? [hashCommit] : [];
  for (const c of messageCommits) if (c.hash !== hashCommit?.hash) result.push(c);
  return result.slice(0, limit);
}

async function searchMessages(
  root: string,
  q: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Commit[]> {
  // git --grep без учёта регистра различает регистр только у ASCII — для кириллицы и прочего
  // фильтруем заголовки последних коммитов сами.
  if (/^[\x20-\x7e]*$/.test(q)) {
    return log(
      root,
      [`-n${limit}`, '--all', '--regexp-ignore-case', '--fixed-strings', `--grep=${q}`],
      signal,
    );
  }
  const needle = q.toLocaleLowerCase();
  const commits = await log(root, [`-n${UNICODE_SEARCH_DEPTH}`, '--all'], signal);
  return commits.filter((c) => c.subject.toLocaleLowerCase().includes(needle)).slice(0, limit);
}

/** Коммит по хешу, имени ветки и т. п.; undefined — не найден или неоднозначен. */
export async function resolveCommit(
  root: string,
  rev: string,
  signal?: AbortSignal,
): Promise<Commit | undefined> {
  try {
    const [commit] = await log(root, ['-n1', '--no-walk', `${rev}^{commit}`], signal);
    return commit;
  } catch (error) {
    if (error instanceof GitError && error.code === 128) return undefined;
    throw error;
  }
}

async function log(root: string, args: string[], signal?: AbortSignal): Promise<Commit[]> {
  // «--» отделяет ревизии от путей: ревизия, похожая на имя файла, не станет путём.
  const out = await gitText(['log', '-z', '--no-color', LOG_FORMAT, ...args, '--'], {
    cwd: root,
    signal,
  });
  return parseLog(out);
}
