// Ревизии по умолчанию для «Сравнить с…» (пункт B.3 плана) на настоящем тестовом репозитории.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Revision } from '../src/diffPanel/session';
import { defaultRevisions } from '../src/features/fileCompare';
import { fileAtRevision } from '../src/git/content';
import { fileState, lastChange } from '../src/git/history';
import { makeRepo, type TestRepo } from './fixtures/repo';

let repo: TestRepo;
const c: Record<string, string> = {};
const short = (hash: string) => hash.slice(0, 7);

beforeAll(() => {
  repo = makeRepo();
  c.first = repo.commit('Первый коммит', {
    'a.txt': 'v1\n',
    'root-only.txt': 'никогда не менялся\n',
    'old/name.ts': 'export const x = 1;\n',
    'modified.txt': 'было\n',
    'deleted.txt': 'удалят\n',
    '.gitignore': '*.log\n',
  });
  c.second = repo.commit('Правка a.txt и новый файл', { 'a.txt': 'v2\n', 'later.txt': 'позже\n' });
  // Переименование: git распознаёт его по содержимому (-M), как и git mv.
  c.third = repo.commit('Переименовать name.ts', {
    'old/name.ts': null,
    'new/name.ts': 'export const x = 1;\n',
  });

  repo.write('modified.txt', 'стало\n');
  repo.write('untracked.txt', 'новый\n');
  repo.write('debug.log', 'игнорируется\n');
  repo.write('staged.txt', 'в индексе\n');
  repo.git('add', 'staged.txt');
  rmSync(join(repo.root, 'deleted.txt'));
});

afterAll(() => repo.remove());

const content = async (r: Revision, path: string) =>
  r.kind === 'rev' ? fileAtRevision(repo.root, r.rev, r.path ?? path) : undefined;

describe('fileState', () => {
  it.each([
    ['a.txt', 'clean'],
    ['modified.txt', 'modified'],
    ['staged.txt', 'modified'],
    ['deleted.txt', 'modified'],
    ['untracked.txt', 'untracked'],
    ['debug.log', 'untracked'],
  ])('%s — %s', async (path, state) => {
    expect(await fileState(repo.root, path)).toBe(state);
  });
});

describe('lastChange', () => {
  it('изменённый файл: родитель и тот же путь', async () => {
    expect(await lastChange(repo.root, 'a.txt')).toMatchObject({
      commit: { hash: c.second },
      parent: c.first,
      pathBefore: 'a.txt',
    });
  });

  it('переименованный: старый путь', async () => {
    expect(await lastChange(repo.root, 'new/name.ts')).toMatchObject({
      commit: { hash: c.third },
      pathBefore: 'old/name.ts',
    });
  });

  it('добавленный: пути до коммита нет', async () => {
    const change = await lastChange(repo.root, 'later.txt');
    expect(change).toMatchObject({ commit: { hash: c.second }, parent: c.first });
    expect(change?.pathBefore).toBeUndefined();
  });

  it('из корневого коммита: родителя нет', async () => {
    const change = await lastChange(repo.root, 'root-only.txt');
    expect(change?.commit.hash).toBe(c.first);
    expect(change?.parent).toBeUndefined();
  });

  it('неизвестный файл и пустой репозиторий — undefined', async () => {
    expect(await lastChange(repo.root, 'untracked.txt')).toBeUndefined();
    const empty = makeRepo();
    try {
      expect(await lastChange(empty.root, 'a.txt')).toBeUndefined();
    } finally {
      empty.remove();
    }
  });
});

describe('defaultRevisions', () => {
  it('без правок — версия до последнего коммита, справа рабочая копия', async () => {
    const { left, right } = await defaultRevisions(repo.root, 'a.txt');
    expect(left).toEqual({
      kind: 'rev',
      rev: c.first,
      label: short(c.first),
      description: `до коммита ${short(c.second)}: Правка a.txt и новый файл`,
      path: undefined,
    });
    expect(right).toEqual({ kind: 'worktree' });
    expect(await content(left, 'a.txt')).toMatchObject({ text: 'v1\n' });
  });

  it('переименован в последнем коммите — слева старый путь', async () => {
    const { left } = await defaultRevisions(repo.root, 'new/name.ts');
    expect(left).toMatchObject({ rev: c.second, path: 'old/name.ts' });
    expect(await content(left, 'new/name.ts')).toMatchObject({ text: 'export const x = 1;\n' });
  });

  it('добавлен в последнем коммите — слева нет файла', async () => {
    const { left } = await defaultRevisions(repo.root, 'later.txt');
    expect(await content(left, 'later.txt')).toEqual({ kind: 'missing' });
  });

  it('только в корневом коммите — слева нет файла', async () => {
    const { left } = await defaultRevisions(repo.root, 'root-only.txt');
    expect(left).toMatchObject({ rev: `${c.first}^`, label: `${short(c.first)}^` });
    expect(await content(left, 'root-only.txt')).toEqual({ kind: 'missing' });
  });

  it.each([
    ['modified.txt', 'незакоммиченные правки'],
    ['staged.txt', 'незакоммиченные правки'],
    ['deleted.txt', 'незакоммиченные правки'],
    ['untracked.txt', 'файл не отслеживается git'],
    ['debug.log', 'файл не отслеживается git'],
  ])('%s — слева HEAD (%s)', async (path, description) => {
    const { left, right } = await defaultRevisions(repo.root, path);
    expect(left).toEqual({ kind: 'rev', rev: 'HEAD', label: 'HEAD', description });
    expect(right).toEqual({ kind: 'worktree' });
  });
});
