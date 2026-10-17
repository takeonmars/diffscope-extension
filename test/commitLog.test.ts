// Окно Git Log: журнал коммитов с метками, порции, фильтр по ветке; дерево веток.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitFiles } from '../src/git/changes';
import { commitLog, parseDecorations } from '../src/git/commitLog';
import { makeRepo, type TestRepo } from './fixtures/repo';

describe('parseDecorations', () => {
  it('HEAD на ветке, тег, удалённая ветка; origin/HEAD пропущен', () => {
    expect(
      parseDecorations(
        'HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main, refs/remotes/origin/HEAD',
      ),
    ).toEqual([
      { kind: 'branch', name: 'main', current: true },
      { kind: 'tag', name: 'v1' },
      { kind: 'remote', name: 'origin/main' },
    ]);
  });

  it('detached HEAD и ветка с «/»', () => {
    expect(parseDecorations('HEAD, refs/heads/feature/x')).toEqual([
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'feature/x', current: undefined },
    ]);
    expect(parseDecorations('')).toEqual([]);
  });
});

describe('commitLog', () => {
  let repo: TestRepo;
  const c: Record<string, string> = {};

  beforeAll(() => {
    repo = makeRepo();
    c.first = repo.commit('Первый', { 'a.txt': '1\n' });
    repo.git('tag', 'v1');
    repo.git('checkout', '-q', '-b', 'feature/x');
    c.feature = repo.commit('Фича', { 'b.txt': 'b\n' });
    repo.git('checkout', '-q', 'main');
    c.main = repo.commit('Main', { 'a.txt': '2\n' });
    repo.git('update-ref', 'refs/remotes/origin/main', c.first);
    // stash — служебная ссылка, в журнале её быть не должно.
    repo.write('a.txt', 'stash\n');
    repo.git('stash', '-q');
    for (let i = 0; i < 5; i++) repo.commit(`Ещё ${i}`, { 'c.txt': `${i}\n` });
  });

  afterAll(() => repo.remove());

  it('все ветки, удалённые и теги; метки у коммитов; без stash', async () => {
    const { commits, hasMore } = await commitLog(repo.root);
    expect(hasMore).toBe(false);
    expect(commits.map((x) => x.subject)).not.toContain('WIP on main');
    expect(
      commits.find((x) => x.subject.startsWith('On main') || x.subject.startsWith('WIP')),
    ).toBeUndefined();
    expect(commits.find((x) => x.hash === c.feature)?.refs).toEqual([
      { kind: 'branch', name: 'feature/x', current: undefined },
    ]);
    expect(commits.find((x) => x.hash === c.first)?.refs).toEqual([
      { kind: 'tag', name: 'v1' },
      { kind: 'remote', name: 'origin/main' },
    ]);
    expect(commits[0].refs).toEqual([{ kind: 'branch', name: 'main', current: true }]);
    expect(commits).toHaveLength(8);
  });

  it('topo-order: коммит раньше своих родителей', async () => {
    const { commits } = await commitLog(repo.root);
    const at = new Map(commits.map((x, i) => [x.hash, i]));
    for (const commit of commits) {
      for (const parent of commit.parents)
        expect(at.get(parent)!).toBeGreaterThan(at.get(commit.hash)!);
    }
  });

  it('одна ветка', async () => {
    const { commits } = await commitLog(repo.root, { ref: 'refs/heads/feature/x' });
    expect(commits.map((x) => x.subject)).toEqual(['Фича', 'Первый']);
  });

  it('порции: hasMore и продолжение без пропусков и повторов', async () => {
    const all = (await commitLog(repo.root)).commits.map((x) => x.hash);
    const first = await commitLog(repo.root, { limit: 3 });
    const second = await commitLog(repo.root, { limit: 3, skip: 3 });
    const third = await commitLog(repo.root, { limit: 3, skip: 6 });
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
    expect([...first.commits, ...second.commits, ...third.commits].map((x) => x.hash)).toEqual(all);
  });

  it('пустой репозиторий — пустой журнал', async () => {
    const empty = makeRepo();
    try {
      expect(await commitLog(empty.root)).toEqual({ commits: [], hasMore: false });
    } finally {
      empty.remove();
    }
  });
});

describe('commitFiles', () => {
  let repo: TestRepo;
  const c: Record<string, string> = {};

  beforeAll(() => {
    repo = makeRepo();
    c.root = repo.commit('Корень', { 'a.txt': '1\n', 'b.txt': 'b\n' });
    c.edit = repo.commit('Правка', { 'a.txt': '2\n', 'b.txt': null, 'c.txt': 'c\n' });
    repo.git('checkout', '-q', '-b', 'dev');
    c.dev = repo.commit('Dev', { 'd.txt': 'd\n' });
    repo.git('checkout', '-q', 'main');
    c.main = repo.commit('Main', { 'a.txt': '3\n' });
    repo.git('merge', '-q', '--no-edit', 'dev', '-m', 'Merge dev');
    c.merge = repo.git('rev-parse', 'HEAD').trim();
  });

  afterAll(() => repo.remove());

  const statuses = (files: { status: string; path: string }[]) =>
    files.map((f) => `${f.status}:${f.path}`).sort();

  it('корневой коммит — против пустого дерева', async () => {
    const { files } = await commitFiles(repo.root, c.root);
    expect(statuses(files)).toEqual(['added:a.txt', 'added:b.txt']);
  });

  it('обычный коммит — против родителя, со строками', async () => {
    const { base, files } = await commitFiles(repo.root, c.edit);
    expect(base).toBe(c.root);
    expect(statuses(files)).toEqual(['added:c.txt', 'deleted:b.txt', 'modified:a.txt']);
    expect(files.find((f) => f.path === 'a.txt')).toMatchObject({ added: 1, removed: 1 });
  });

  it('merge — против первого родителя: то, что пришло из ветки', async () => {
    const { base, files } = await commitFiles(repo.root, c.merge);
    expect(base).toBe(c.main);
    expect(statuses(files)).toEqual(['added:d.txt']);
  });
});
