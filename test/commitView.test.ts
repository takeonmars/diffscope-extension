// «Посмотреть изменения» коммита: набор файлов для вкладки «все файлы».
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commitFileSet } from '../src/features/commitView';
import { fileAtRevision } from '../src/git/content';
import { makeRepo, type TestRepo } from './fixtures/repo';

describe('commitFileSet', () => {
  let repo: TestRepo;
  const c: Record<string, string> = {};

  beforeAll(() => {
    repo = makeRepo();
    c.root = repo.commit('Корень', { 'old.ts': 'export const x = 1;\n', 'a.txt': '1\n' });
    c.rename = repo.commit('Переименовать и поправить', {
      'old.ts': null,
      'src/new.ts': 'export const x = 1;\n',
      'a.txt': '2\n',
    });
    repo.git('checkout', '-q', '-b', 'dev');
    repo.commit('Dev', { 'd.txt': 'd\n' });
    repo.git('checkout', '-q', 'main');
    repo.commit('Main', { 'a.txt': '3\n' });
    repo.git('merge', '-q', '--no-edit', 'dev', '-m', 'Merge dev');
    c.merge = repo.git('rev-parse', 'HEAD').trim();
  });

  afterAll(() => repo.remove());

  it('обычный коммит: заголовки сторон, переименованный — слева по старому пути', async () => {
    const set = await commitFileSet(repo.root, c.rename);
    const short = c.rename.slice(0, 7);
    expect(set).toMatchObject({
      tabTitle: `Коммит ${short}: Переименовать и поправить`,
      left: { label: `${short}^`, description: 'родитель' },
      right: { label: short, description: 'Переименовать и поправить' },
    });
    expect(set.note).toBeUndefined();
    const renamed = set.files.find((f) => f.status === 'renamed')!;
    const { left, right } = set.revisions(renamed);
    expect(left).toMatchObject({ rev: c.root, path: 'old.ts' });
    expect(right).toMatchObject({ rev: c.rename });
    expect(await fileAtRevision(repo.root, c.root, 'old.ts')).toMatchObject({
      text: 'export const x = 1;\n',
    });
  });

  it('корневой коммит — все файлы добавлены, слева пусто', async () => {
    const set = await commitFileSet(repo.root, c.root);
    expect(set.left.description).toBe('пусто — корневой коммит');
    expect(set.files.map((f) => f.status)).toEqual(['added', 'added']);
  });

  it('merge — против первого родителя, с пометкой', async () => {
    const set = await commitFileSet(repo.root, c.merge);
    expect(set.files.map((f) => f.path)).toEqual(['d.txt']);
    expect(set.note).toBe('Merge-коммит: изменения относительно первого родителя.');
  });
});
