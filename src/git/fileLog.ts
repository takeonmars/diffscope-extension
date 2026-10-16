// История файла целиком: `git log --follow --name-status -- путь`. У каждого коммита — путь файла
// до и после (переименования отслеживаются, --follow).
import { LOG_FORMAT, parseLog, type Commit } from './parsers/log';
import { unquotePath } from './parsers/quote';
import { gitText } from './runner';

export interface FileLogEntry {
  commit: Commit;
  /** Путь до коммита; undefined — коммит создал файл. */
  pathBefore?: string;
  pathAfter: string;
}

const RECORD = '\x1e';

export async function fileLog(
  root: string,
  path: string,
  {
    rev = 'HEAD',
    signal,
    firstParent = false,
    limit = 1000,
  }: { rev?: string; signal?: AbortSignal; firstParent?: boolean; limit?: number } = {},
): Promise<FileLogEntry[]> {
  const out = await gitText(
    [
      'log',
      '--follow',
      `-n${limit}`,
      // -m: у merge-коммита (первый родитель) тоже показать изменения файла.
      ...(firstParent ? ['--first-parent', '-m'] : []),
      '--name-status',
      '--no-color',
      LOG_FORMAT.replace('--format=', '--format=%x1e'),
      rev,
      '--',
      path,
    ],
    { cwd: root, signal, timeout: 120_000, okCodes: [0, 128] },
  );
  return parseFileLog(out);
}

export function parseFileLog(output: string): FileLogEntry[] {
  const entries: FileLogEntry[] = [];
  for (const record of output.split(RECORD)) {
    if (!record.trim()) continue;
    const newline = record.indexOf('\n');
    const [commit] = parseLog(`${newline === -1 ? record : record.slice(0, newline)}\0`);
    if (!commit) continue;
    const status = record
      .slice(newline + 1)
      .split('\n')
      .find((line) => /^[A-Z]\d*\t/.test(line));
    if (!status) continue;
    const [code, ...paths] = status.split('\t').map(unquotePath);
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      entries.push({
        commit,
        pathBefore: kind === 'R' ? paths[0] : undefined,
        pathAfter: paths[1],
      });
    } else if (kind === 'A') {
      entries.push({ commit, pathAfter: paths[0] });
    } else {
      entries.push({ commit, pathBefore: paths[0], pathAfter: paths[0] });
    }
  }
  return entries;
}

/**
 * Merge-коммиты, в которых файл отличается от всех родителей (обычное упрощение истории git:
 * merge, совпадающий с одним из родителей, не показывается). Среди них — merge с правками при
 * разрешении конфликта; `git log --name-status` без -m их не показывает.
 */
export async function mergesTouching(
  root: string,
  path: string,
  { signal, limit = 200 }: { signal?: AbortSignal; limit?: number } = {},
): Promise<Commit[]> {
  const out = await gitText(
    ['log', '-z', '--merges', `-n${limit}`, '--no-color', LOG_FORMAT, 'HEAD', '--', path],
    { cwd: root, signal, timeout: 120_000, okCodes: [0, 128] },
  );
  return parseLog(out);
}
