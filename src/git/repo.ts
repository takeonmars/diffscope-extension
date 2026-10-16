// Репозиторий по файлу: корень (git rev-parse --show-toplevel), shallow-клон, путь файла в нём.
// Корень ищется от папки файла — так находятся сабмодули и вложенные репозитории.
import { realpath } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';
import { GitError, gitText } from './runner';

export interface RepoInfo {
  /** Корень рабочей копии, без символических ссылок. */
  root: string;
  /** История обрезана (git clone --depth). */
  shallow: boolean;
}

const byDirectory = new Map<string, Promise<RepoInfo | undefined>>();

/** Репозиторий, в котором лежит файл, или undefined, если файл вне git. */
export function findRepo(filePath: string, signal?: AbortSignal): Promise<RepoInfo | undefined> {
  const dir = dirname(filePath);
  let found = byDirectory.get(dir);
  if (!found) {
    found = lookup(dir, signal);
    byDirectory.set(dir, found);
    // Ошибку и отмену не кешируем.
    found.catch(() => byDirectory.delete(dir));
  }
  return found;
}

async function lookup(dir: string, signal?: AbortSignal): Promise<RepoInfo | undefined> {
  const cwd = await realExistingDir(dir);
  try {
    const out = await gitText(['rev-parse', '--show-toplevel', '--is-shallow-repository'], {
      cwd,
      signal,
    });
    const [root, shallow] = out.trim().split('\n');
    return { root: await realpath(root), shallow: shallow === 'true' };
  } catch (error) {
    // 128 — «not a git repository».
    if (error instanceof GitError && error.code === 128) return undefined;
    throw error;
  }
}

/** Ближайшая существующая папка (файл мог быть удалён вместе с папкой), без ссылок. */
async function realExistingDir(dir: string): Promise<string> {
  for (let current = dir; ; current = dirname(current)) {
    try {
      return await realpath(current);
    } catch {
      if (dirname(current) === current) return current;
    }
  }
}

/** Путь файла относительно корня репозитория, через «/», как его понимает git. */
export async function repoPath(root: string, filePath: string): Promise<string> {
  let real: string;
  try {
    real = await realpath(filePath);
  } catch {
    // Файла нет на диске (удалён) — достаточно реального пути папки.
    real = `${await realExistingDir(dirname(filePath))}${sep}${filePath.split(sep).pop()}`;
  }
  return relative(root, real).split(sep).join('/');
}

/** Для тестов: забыть найденные репозитории. */
export function clearRepoCache(): void {
  byDirectory.clear();
}
