// Слой git на настоящих тестовых репозиториях.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { changedFiles } from '../src/git/changes';
import { clearContentCache, decode, fileAtRevision } from '../src/git/content';
import { getHead, listRefs, recentCommits, resolveCommit, searchCommits } from '../src/git/refs';
import { clearRepoCache, findRepo, repoPath } from '../src/git/repo';
import {
  GitCancelledError,
  GitError,
  runGit,
  setGitPath,
  setGitTrace,
  type GitTrace,
} from '../src/git/runner';
import { BINARY, makeRepo, type TestRepo } from './fixtures/repo';

let repo: TestRepo;
const c: Record<string, string> = {};

beforeAll(() => {
  repo = makeRepo();
  c.first = repo.commit('Первый коммит', {
    'a.txt': 'one\ntwo\n',
    'src/app.ts': 'export const app = 1;\n',
    'image.png': BINARY,
    'файл с пробелом.txt': 'привет\n',
    'crlf.txt': 'one\r\ntwo\r\n',
  });
  repo.git('tag', 'v1');
  repo.git('tag', '-a', 'v1-annotated', '-m', 'Аннотированный тег');
  c.second = repo.commit('Change a.txt', { 'a.txt': 'one\nTWO\nthree\n' });
  repo.git('checkout', '-q', '-b', 'feature');
  c.feature = repo.commit('Фича: переименовать app', {
    'src/app.ts': null,
    'src/main.ts': 'export const app = 1;\n',
    'new.txt': 'новый\n',
    'image.png': null,
  });
  repo.git('checkout', '-q', 'main');
  c.main = repo.commit('README on main', { 'README.md': '# Тест\n' });
  // «Удалённая» ветка без сети: ссылки как после fetch.
  repo.git('update-ref', 'refs/remotes/origin/main', c.second);
  repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
});

afterAll(() => repo.remove());

beforeEach(() => {
  clearRepoCache();
  clearContentCache();
  setGitTrace(undefined);
});

describe('runGit', () => {
  it('ошибка git — с кодом и stderr', async () => {
    const error = await runGit(['rev-parse', '--verify', 'нет-такой'], { cwd: repo.root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitError);
    expect((error as GitError).code).toBe(128);
  });

  it('отмена убивает процесс', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const run = runGit(['-c', 'alias.slow=!sleep 5', 'slow'], {
      cwd: repo.root,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(run).rejects.toBeInstanceOf(GitCancelledError);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('уже отменённый сигнал — без запуска', async () => {
    await expect(
      runGit(['status'], { cwd: repo.root, signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(GitCancelledError);
  });

  it('таймаут', async () => {
    await expect(
      runGit(['-c', 'alias.slow=!sleep 5', 'slow'], { cwd: repo.root, timeout: 200 }),
    ).rejects.toThrow('превышено время ожидания');
  });

  it('слишком большой вывод', async () => {
    await expect(runGit(['log'], { cwd: repo.root, maxOutput: 10 })).rejects.toThrow(
      'слишком большой вывод',
    );
  });

  it('git не найден', async () => {
    setGitPath('/нет/такого/git');
    try {
      await expect(runGit(['status'], { cwd: repo.root })).rejects.toThrow('git не найден');
    } finally {
      setGitPath('git');
    }
  });

  it('пишет журнал команд', async () => {
    const entries: GitTrace[] = [];
    setGitTrace((e) => entries.push(e));
    await runGit(['status'], { cwd: repo.root });
    expect(entries).toMatchObject([{ args: ['status'], code: 0 }]);
  });
});

describe('repo', () => {
  it('корень по файлу во вложенной папке', async () => {
    expect(await findRepo(join(repo.root, 'src/app.ts'))).toEqual({
      root: repo.root,
      shallow: false,
    });
  });

  it('вне репозитория — undefined', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'diffscope-outside-')));
    try {
      expect(await findRepo(join(outside, 'x.txt'))).toBeUndefined();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('путь в репозитории: кириллица, пробелы, ссылки, удалённый файл', async () => {
    expect(await repoPath(repo.root, join(repo.root, 'файл с пробелом.txt'))).toBe(
      'файл с пробелом.txt',
    );
    const links = realpathSync(mkdtempSync(join(tmpdir(), 'diffscope-link-')));
    try {
      symlinkSync(repo.root, join(links, 'repo'));
      expect(await repoPath(repo.root, join(links, 'repo', 'src', 'app.ts'))).toBe('src/app.ts');
    } finally {
      rmSync(links, { recursive: true, force: true });
    }
    expect(await repoPath(repo.root, join(repo.root, 'src', 'удалён.ts'))).toBe('src/удалён.ts');
  });

  it('файл в удалённой папке — корень ищется от существующей', async () => {
    expect((await findRepo(join(repo.root, 'нет', 'папки', 'x.ts')))?.root).toBe(repo.root);
  });

  it('shallow-клон', async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'diffscope-shallow-')));
    try {
      const clone = join(parent, 'clone');
      repo.git('clone', '-q', '--depth', '1', `file://${repo.root}`, clone);
      expect(await findRepo(join(clone, 'a.txt'))).toEqual({ root: clone, shallow: true });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('refs', () => {
  it('ветки, удалённые ветки и теги; origin/HEAD пропущен', async () => {
    const refs = await listRefs(repo.root);
    const names = refs.map((r) => `${r.kind}:${r.name}`).sort();
    expect(names).toEqual([
      'branch:feature',
      'branch:main',
      'remote:origin/main',
      'tag:v1',
      'tag:v1-annotated',
    ]);
    // Аннотированный тег указывает на коммит, а не на объект тега.
    expect(refs.find((r) => r.name === 'v1-annotated')?.commit).toBe(c.first);
    expect(refs.find((r) => r.name === 'main')).toMatchObject({
      fullName: 'refs/heads/main',
      commit: c.main,
      subject: 'README on main',
    });
  });

  it('HEAD: ветка и коммит; detached HEAD в git worktree', async () => {
    expect(await getHead(repo.root)).toEqual({ commit: c.main, branch: 'main' });
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'diffscope-wt-')));
    const wt = join(parent, 'wt');
    try {
      repo.git('worktree', 'add', '--detach', wt, c.first); // без -q: его нет в 2.15
      expect(await getHead(wt)).toEqual({ commit: c.first, branch: undefined });
      expect((await findRepo(join(wt, 'a.txt')))?.root).toBe(wt);
    } finally {
      // git worktree remove есть только с 2.17.
      rmSync(parent, { recursive: true, force: true });
      repo.git('worktree', 'prune');
    }
  });

  it('пустой репозиторий', async () => {
    const empty = makeRepo();
    try {
      expect(await getHead(empty.root)).toEqual({ commit: undefined, branch: 'main' });
      expect(await recentCommits(empty.root)).toEqual([]);
      expect(await listRefs(empty.root)).toEqual([]);
    } finally {
      empty.remove();
    }
  });

  it('недавние коммиты текущей ветки — новые первыми', async () => {
    const commits = await recentCommits(repo.root);
    expect(commits.map((x) => x.subject)).toEqual([
      'README on main',
      'Change a.txt',
      'Первый коммит',
    ]);
    expect(commits[0]).toMatchObject({
      hash: c.main,
      parents: [c.second],
      author: 'Тест',
      email: 'test@example.com',
    });
    expect(commits[0].shortHash).toBe(c.main.slice(0, commits[0].shortHash.length));
    expect(commits[0].date).toBeGreaterThan(commits[1].date);
    expect(commits[2].parents).toEqual([]);
  });

  it('поиск: по хешу, по сообщению во всех ветках, без учёта регистра', async () => {
    expect((await searchCommits(repo.root, c.feature.slice(0, 7))).map((x) => x.hash)[0]).toBe(
      c.feature,
    );
    expect((await searchCommits(repo.root, 'readme')).map((x) => x.subject)).toEqual([
      'README on main',
    ]);
    // Кириллица: git --grep без учёта регистра понимает только ASCII — ищем сами.
    expect((await searchCommits(repo.root, 'фича')).map((x) => x.subject)).toEqual([
      'Фича: переименовать app',
    ]);
    expect(await searchCommits(repo.root, 'нет такого')).toEqual([]);
    expect(await searchCommits(repo.root, '  ')).toEqual([]);
  });

  it('resolveCommit: ветка, тег, неизвестное', async () => {
    expect((await resolveCommit(repo.root, 'feature'))?.hash).toBe(c.feature);
    expect((await resolveCommit(repo.root, 'v1-annotated'))?.hash).toBe(c.first);
    expect(await resolveCommit(repo.root, 'нет-такой')).toBeUndefined();
  });
});

describe('fileAtRevision', () => {
  it('текст на разных ревизиях', async () => {
    expect(await fileAtRevision(repo.root, c.first, 'a.txt')).toMatchObject({
      kind: 'text',
      text: 'one\ntwo\n',
    });
    expect(await fileAtRevision(repo.root, 'main', 'a.txt')).toMatchObject({
      text: 'one\nTWO\nthree\n',
    });
    expect(await fileAtRevision(repo.root, 'v1', 'файл с пробелом.txt')).toMatchObject({
      text: 'привет\n',
    });
  });

  it('CRLF сохраняется как есть', async () => {
    expect(await fileAtRevision(repo.root, 'HEAD', 'crlf.txt')).toMatchObject({
      text: 'one\r\ntwo\r\n',
    });
  });

  it('нет файла на ревизии; путь — папка', async () => {
    expect(await fileAtRevision(repo.root, c.first, 'README.md')).toEqual({ kind: 'missing' });
    expect(await fileAtRevision(repo.root, 'feature', 'image.png')).toEqual({ kind: 'missing' });
    expect(await fileAtRevision(repo.root, 'HEAD', 'src')).toEqual({ kind: 'missing' });
    expect(await fileAtRevision(repo.root, 'нет-такой', 'a.txt')).toEqual({ kind: 'missing' });
  });

  it('двоичный и слишком большой файл', async () => {
    expect(await fileAtRevision(repo.root, 'HEAD', 'image.png')).toMatchObject({
      kind: 'binary',
      size: BINARY.length,
    });
    expect(await fileAtRevision(repo.root, 'HEAD', 'a.txt', { maxSize: 5 })).toMatchObject({
      kind: 'tooLarge',
      size: 14,
    });
  });

  it('одинаковый blob на разных ревизиях читается один раз', async () => {
    const entries: GitTrace[] = [];
    setGitTrace((e) => entries.push(e));
    await fileAtRevision(repo.root, c.first, 'src/app.ts');
    await fileAtRevision(repo.root, 'feature', 'src/main.ts'); // то же содержимое
    expect(entries.filter((e) => e.args[1] === 'blob')).toHaveLength(1);
  });

  it('отмена', async () => {
    await expect(
      fileAtRevision(repo.root, 'HEAD', 'a.txt', { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(GitCancelledError);
  });

  it('decode: BOM убирается, неверный UTF-8 не роняет', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);
    expect(decode(bom, 'x')).toEqual({ kind: 'text', text: 'a', blob: 'x' });
    expect(decode(Buffer.from([0x61, 0xff, 0x62]), 'x')).toMatchObject({ text: 'a�b' });
  });
});

describe('changedFiles', () => {
  const sorted = (files: Awaited<ReturnType<typeof changedFiles>>) =>
    [...files].sort((x, y) => (x.path < y.path ? -1 : 1));

  it('как в PR: только изменения ветки, переименование распознано', async () => {
    expect(sorted(await changedFiles(repo.root, 'main', 'feature', 'pr'))).toEqual([
      { status: 'deleted', path: 'image.png', binary: true },
      { status: 'added', path: 'new.txt', added: 1, removed: 0 },
      {
        status: 'renamed',
        path: 'src/main.ts',
        oldPath: 'src/app.ts',
        similarity: 100,
        added: 0,
        removed: 0,
      },
    ]);
  });

  it('прямое: плюс изменения main после ответвления', async () => {
    expect(sorted(await changedFiles(repo.root, 'main', 'feature', 'direct'))).toEqual([
      { status: 'deleted', path: 'README.md', added: 0, removed: 1 },
      { status: 'deleted', path: 'image.png', binary: true },
      { status: 'added', path: 'new.txt', added: 1, removed: 0 },
      {
        status: 'renamed',
        path: 'src/main.ts',
        oldPath: 'src/app.ts',
        similarity: 100,
        added: 0,
        removed: 0,
      },
    ]);
  });

  it('с рабочей копией', async () => {
    const dir = join(repo.root, 'tmp-dir');
    mkdirSync(dir, { recursive: true });
    repo.write('a.txt', 'изменено\n');
    try {
      expect(await changedFiles(repo.root, 'HEAD', undefined, 'direct')).toEqual([
        { status: 'modified', path: 'a.txt', added: 1, removed: 3 },
      ]);
    } finally {
      repo.git('checkout', '-q', '--', 'a.txt');
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
