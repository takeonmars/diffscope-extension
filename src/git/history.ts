// История одного файла: состояние в рабочей копии и последний коммит, который его менял.
import { changedFiles } from './changes';
import { LOG_FORMAT, parseLog, type Commit } from './parsers/log';
import { gitText } from './runner';

/**
 * - `clean` — совпадает с HEAD;
 * - `modified` — есть незакоммиченные правки (в индексе или рабочей копии, включая удаление);
 * - `untracked` — git о файле не знает (новый или в .gitignore).
 */
export type FileState = 'clean' | 'modified' | 'untracked';

export async function fileState(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<FileState> {
  // --ignored: игнорируемый файл тоже «не отслеживается», а не «без изменений».
  const out = await gitText(['status', '--porcelain', '-z', '--ignored', '--', path], {
    cwd: root,
    signal,
  });
  if (!out) return 'clean';
  const code = out.slice(0, 2);
  return code === '??' || code === '!!' ? 'untracked' : 'modified';
}

export interface LastChange {
  commit: Commit;
  /** Первый родитель коммита; undefined — корневой коммит. */
  parent?: string;
  /** Путь файла в родителе: другой, если коммит его переименовал; undefined — файл добавлен. */
  pathBefore?: string;
}

/** Последний коммит из истории HEAD, который менял файл; undefined — таких нет. */
export async function lastChange(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<LastChange | undefined> {
  const out = await gitText(['log', '-z', '-n1', LOG_FORMAT, 'HEAD', '--', path], {
    cwd: root,
    signal,
    okCodes: [0, 128], // 128 — в репозитории нет коммитов
  });
  const [commit] = parseLog(out);
  if (!commit) return undefined;
  const parent = commit.parents[0];
  if (!parent) return { commit };
  // Без ограничения путём: иначе git не увидит старое имя и покажет переименование как добавление.
  const files = await changedFiles(root, parent, commit.hash, 'direct', signal);
  const entry = files.find((f) => f.path === path);
  const pathBefore =
    !entry || entry.status === 'modified' || entry.status === 'typeChanged'
      ? path
      : entry.status === 'renamed'
        ? entry.oldPath
        : undefined; // added, copied — до коммита этого файла не было
  return { commit, parent, pathBefore };
}
