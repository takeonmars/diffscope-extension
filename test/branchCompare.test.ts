// Сравнение веток: общий предок, режимы «как в PR» и «прямое», рабочая копия, ветка по умолчанию.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compareBranches,
  comparisonTitle,
  fileRevisions,
  type RevRevision,
} from '../src/features/branchCompare';
import { buildFileTree } from '../src/features/fileTree';
import { defaultBranch, listRefs, mergeBase } from '../src/git/refs';
import { makeRepo, type TestRepo } from './fixtures/repo';

let repo: TestRepo;
const c: Record<string, string> = {};
const rev = (name: string): RevRevision => ({
  kind: 'rev',
  rev: `refs/heads/${name}`,
  label: name,
});
const paths = (files: { status: string; path: string; oldPath?: string }[]) =>
  files.map((f) => `${f.status}:${f.oldPath ? `${f.oldPath}→` : ''}${f.path}`).sort();

beforeAll(() => {
  repo = makeRepo();
  c.base = repo.commit('Основа', {
    'a.txt': 'a\n',
    'old.ts': 'export const x = 1;\n',
    'keep.txt': 'k\n',
  });
  repo.git('checkout', '-q', '-b', 'feature');
  c.feature = repo.commit('Фича', {
    'a.txt': 'a!\n',
    'old.ts': null,
    'src/new.ts': 'export const x = 1;\n',
    'added.txt': 'новый\n',
  });
  repo.git('checkout', '-q', 'main');
  c.main = repo.commit('Main после ответвления', { 'main-only.txt': 'm\n', 'keep.txt': null });
});

afterAll(() => repo.remove());

describe('compareBranches', () => {
  it('как в PR: левая сторона — общий предок, видно только сделанное в ветке', async () => {
    const result = await compareBranches(repo.root, rev('main'), rev('feature'), 'pr');
    expect(result.left.rev).toBe(c.base);
    expect(result.left.label).toBe('main');
    expect(paths(result.files)).toEqual([
      'added:added.txt',
      'modified:a.txt',
      'renamed:old.ts→src/new.ts',
    ]);
  });

  it('прямое: плюс изменения main после ответвления', async () => {
    const result = await compareBranches(repo.root, rev('main'), rev('feature'), 'direct');
    expect(result.left.rev).toBe('refs/heads/main');
    expect(paths(result.files)).toEqual([
      'added:added.txt',
      'added:keep.txt',
      'deleted:main-only.txt',
      'modified:a.txt',
      'renamed:old.ts→src/new.ts',
    ]);
  });

  it('справа рабочая копия', async () => {
    repo.write('a.txt', 'правка в рабочей копии\n');
    try {
      const result = await compareBranches(repo.root, rev('main'), { kind: 'worktree' }, 'direct');
      expect(paths(result.files)).toEqual(['modified:a.txt']);
      expect(fileRevisions(result, result.files[0]).right).toEqual({ kind: 'worktree' });
    } finally {
      repo.git('checkout', '-q', '--', 'a.txt');
    }
  });

  it('ревизии сторон файла: переименованный — слева старый путь', async () => {
    const result = await compareBranches(repo.root, rev('main'), rev('feature'), 'pr');
    const renamed = result.files.find((f) => f.status === 'renamed')!;
    expect(fileRevisions(result, renamed)).toMatchObject({
      left: { rev: c.base, path: 'old.ts' },
      right: { rev: 'refs/heads/feature', path: undefined },
    });
  });

  it('без общей истории — прямое сравнение с пометкой', async () => {
    repo.git('checkout', '-q', '--orphan', 'orphan');
    repo.git('rm', '-q', '-rf', '.');
    repo.commit('Отдельная история', { 'z.txt': 'z\n' });
    repo.git('checkout', '-q', 'main');
    const result = await compareBranches(repo.root, rev('main'), rev('orphan'), 'pr');
    expect(result.noMergeBase).toBe(true);
    expect(result.left.rev).toBe('refs/heads/main');
    expect(await mergeBase(repo.root, 'main', 'orphan')).toBeUndefined();
  });

  it('заголовок как в git', () => {
    expect(comparisonTitle({ base: rev('main'), target: rev('feature'), mode: 'pr' })).toBe(
      'main...feature',
    );
    expect(
      comparisonTitle({ base: rev('main'), target: { kind: 'worktree' }, mode: 'direct' }),
    ).toBe('main..рабочая копия');
  });
});

describe('defaultBranch', () => {
  it('main, если нет origin/HEAD', async () => {
    expect((await defaultBranch(repo.root, await listRefs(repo.root)))?.name).toBe('main');
  });

  it('ветка, на которую указывает origin/HEAD', async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'diffscope-clone-')));
    try {
      const clone = join(parent, 'clone');
      repo.git('clone', '-q', '--branch', 'feature', `file://${repo.root}`, clone);
      // В клоне origin/HEAD указывает на ветку по умолчанию оригинала (HEAD оригинала — main).
      const refs = await listRefs(clone);
      expect((await defaultBranch(clone, refs))?.name).toBe('origin/main');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('buildFileTree', () => {
  const file = (path: string) => ({ status: 'modified' as const, path });

  it('папки первыми, по алфавиту; цепочки из одной папки сжаты', () => {
    const tree = buildFileTree([
      file('src/git/a.ts'),
      file('src/git/b.ts'),
      file('README.md'),
      file('docs/x/y/z.md'),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['docs/x/y', 'src/git', 'README.md']);
    const src = tree[1];
    expect(src.kind === 'folder' && src.children.map((n) => n.name)).toEqual(['a.ts', 'b.ts']);
    expect(src.kind === 'folder' && src.count).toBe(2);
  });

  it('файл и папка на одном уровне — не сжимаются', () => {
    const tree = buildFileTree([file('src/a.ts'), file('src/lib/b.ts')]);
    expect(tree.map((n) => n.name)).toEqual(['src']);
    const src = tree[0];
    expect(src.kind === 'folder' && src.children.map((n) => n.name)).toEqual(['lib', 'a.ts']);
  });
});
