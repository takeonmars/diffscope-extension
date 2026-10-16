// Функция B, «Сравнить с…»: ревизии по умолчанию (пункт B.3 плана).
// Справа — рабочая копия. Слева — HEAD, если в файле есть незакоммиченные правки (или git о нём
// не знает); иначе — версия до последнего коммита, менявшего файл: видна последняя правка.
import { WORKTREE, type Revision } from '../diffPanel/session';
import { fileState, lastChange } from '../git/history';

export interface DefaultRevisions {
  left: Revision;
  right: Revision;
}

const HEAD: Extract<Revision, { kind: 'rev' }> = {
  kind: 'rev',
  rev: 'HEAD',
  label: 'HEAD',
  description: 'последний коммит',
};

export async function defaultRevisions(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<DefaultRevisions> {
  const state = await fileState(root, path, signal);
  if (state === 'untracked') {
    return { left: { ...HEAD, description: 'файл не отслеживается git' }, right: WORKTREE };
  }
  if (state === 'modified') {
    return { left: { ...HEAD, description: 'незакоммиченные правки' }, right: WORKTREE };
  }

  const change = await lastChange(root, path, signal);
  if (!change) return { left: HEAD, right: WORKTREE };
  const { commit, parent, pathBefore } = change;
  const description = `до коммита ${commit.shortHash}: ${commit.subject}`;
  return {
    left: {
      kind: 'rev',
      // Корневой коммит: «<хеш>^» не существует — сторона покажется как «нет файла».
      rev: parent ?? `${commit.hash}^`,
      label: parent ? parent.slice(0, commit.shortHash.length) : `${commit.shortHash}^`,
      description,
      // Файла до коммита не было — путь неважен: его нет ни под каким именем.
      path: pathBefore && pathBefore !== path ? pathBefore : undefined,
    },
    right: WORKTREE,
  };
}
