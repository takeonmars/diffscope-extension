// История по строкам: перевод выделения в строки HEAD, git log -L на тестовом репозитории.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lineHistory, selectionInHead } from '../src/features/lineHistory';
import { ownLines } from '../src/features/mergeEdits';
import { selectedLines } from '../src/features/selection';
import { fileAtRevision } from '../src/git/content';
import { fileLog, parseFileLog } from '../src/git/fileLog';
import { lineLog, parseLineLog } from '../src/git/lineLog';
import { makeRepo, type TestRepo } from './fixtures/repo';

const lines = (...l: string[]) => l.join('\n') + '\n';

describe('selectionInHead', () => {
  const head = lines('a', 'b', 'c', 'd', 'e');

  it('без правок — те же строки', () => {
    expect(selectionInHead(head, head, { from: 2, to: 4 })).toEqual({
      head: { from: 2, to: 4 },
      uncommitted: false,
    });
  });

  it('строки выше вставлены — номера сдвигаются', () => {
    const current = lines('new1', 'new2', 'a', 'b', 'c', 'd', 'e');
    expect(selectionInHead(head, current, { from: 4, to: 5 })).toEqual({
      head: { from: 2, to: 3 },
      uncommitted: false,
    });
  });

  it('изменённая строка в выделении — её прежний вид', () => {
    const current = lines('a', 'B', 'c', 'd', 'e');
    expect(selectionInHead(head, current, { from: 2, to: 3 })).toEqual({
      head: { from: 2, to: 3 },
      uncommitted: true,
    });
  });

  it('добавленные строки отбрасываются', () => {
    const current = lines('a', 'b', 'x', 'y', 'c', 'd', 'e');
    expect(selectionInHead(head, current, { from: 2, to: 4 })).toEqual({
      head: { from: 2, to: 2 },
      uncommitted: true,
    });
  });

  it('целиком новое выделение — в HEAD нечего искать', () => {
    const current = lines('a', 'b', 'x', 'y', 'c', 'd', 'e');
    expect(selectionInHead(head, current, { from: 3, to: 4 })).toEqual({
      head: undefined,
      uncommitted: true,
    });
  });

  it('удалённые строки внутри выделения', () => {
    const current = lines('a', 'd', 'e');
    expect(selectionInHead(head, current, { from: 1, to: 2 })).toEqual({
      head: { from: 1, to: 4 },
      uncommitted: true,
    });
  });

  it('файла нет в HEAD', () => {
    expect(selectionInHead(undefined, head, { from: 1, to: 2 })).toEqual({ uncommitted: true });
  });
});

describe('parseLineLog', () => {
  it('создание файла, правка, переименование, кавычки в пути', () => {
    const header = (h: string, s: string) =>
      `\x1e${[h, h.slice(0, 7), '', 'Имя', 'a@b', '1700000000', s].join('\0')}\n\n`;
    const out =
      header('1'.repeat(40), 'правка') +
      'diff --git a/old.txt b/new.txt\n--- a/old.txt\n+++ b/new.txt\n@@ -2,2 +3,3 @@\n x\n-y\n+Y\n+z\n' +
      header('2'.repeat(40), 'создать') +
      'diff --git a/q b/q\n--- /dev/null\n+++ "b/\\321\\204 \\"q\\".txt"\n@@ -0,0 +1,2 @@\n+x\n+y\n';
    expect(parseLineLog(out)).toEqual([
      expect.objectContaining({
        before: { path: 'old.txt', range: { from: 2, to: 3 } },
        after: { path: 'new.txt', range: { from: 3, to: 5 } },
      }),
      expect.objectContaining({
        before: undefined,
        after: { path: 'ф "q".txt', range: { from: 1, to: 2 } },
      }),
    ]);
  });
});

describe('lineLog и lineHistory на репозитории', () => {
  let repo: TestRepo;
  const c: Record<string, string> = {};

  beforeAll(() => {
    repo = makeRepo();
    c.create = repo.commit('Создать', { 'f.txt': lines('a', 'b', 'c', 'd', 'e') });
    c.edit = repo.commit('Правка b', { 'f.txt': lines('a', 'B', 'c', 'd', 'e') });
    c.other = repo.commit('Правка e', { 'f.txt': lines('a', 'B', 'c', 'd', 'E') });
    c.rename = repo.commit('Переименовать', {
      'f.txt': null,
      'dir/g h.txt': lines('a', 'B', 'c', 'd', 'E'),
    });
    c.insert = repo.commit('Вставка сверху и правка c', {
      'dir/g h.txt': lines('z', 'a', 'B', 'C', 'd', 'E'),
    });
  });

  afterAll(() => repo.remove());

  it('коммиты, менявшие строки, с путями и диапазонами; лишние пропущены', async () => {
    const entries = await lineLog(repo.root, 'dir/g h.txt', { from: 3, to: 4 });
    expect(entries.map((e) => e.commit.subject)).toEqual([
      'Вставка сверху и правка c',
      'Правка b',
      'Создать',
    ]);
    expect(entries[0]).toMatchObject({
      before: { path: 'dir/g h.txt', range: { from: 2, to: 3 } },
      after: { path: 'dir/g h.txt', range: { from: 3, to: 4 } },
    });
    // До переименования — старый путь.
    expect(entries[1]).toMatchObject({
      before: { path: 'f.txt' },
      after: { path: 'f.txt', range: { from: 2, to: 3 } },
    });
    expect(entries[2].kind === 'change' && entries[2].before).toBeUndefined();
  });

  it('с незакоммиченной правкой: первая строка — она, номера пересчитаны', async () => {
    const headText = await fileAtRevision(repo.root, 'HEAD', 'dir/g h.txt');
    const current = lines('новая', 'z', 'a', 'B', 'C!', 'd', 'E');
    const items = await lineHistory({
      root: repo.root,
      path: 'dir/g h.txt',
      headText: headText.kind === 'text' ? headText.text : undefined,
      currentText: current,
      selection: { from: 4, to: 5 }, // «B», «C!» — в HEAD строки 3–4
    });
    expect(items[0]).toMatchObject({
      kind: 'uncommitted',
      fragment: { left: { from: 3, to: 4 }, right: { from: 4, to: 5 } },
    });
    expect(items.slice(1).map((i) => (i.kind === 'commit' ? i.commit.subject : ''))).toEqual([
      'Вставка сверху и правка c',
      'Правка b',
      'Создать',
    ]);
    const edit = items.find((i) => i.kind === 'commit' && i.commit.hash === c.edit);
    expect(edit).toMatchObject({
      left: { rev: `${c.edit}^`, path: 'f.txt' },
      right: { rev: c.edit, path: 'f.txt' },
      fragment: { left: { from: 2, to: 3 }, right: { from: 2, to: 3 } },
    });
  });

  it('целиком новое выделение — только незакоммиченные правки', async () => {
    const headText = await fileAtRevision(repo.root, 'HEAD', 'dir/g h.txt');
    const items = await lineHistory({
      root: repo.root,
      path: 'dir/g h.txt',
      headText: headText.kind === 'text' ? headText.text : undefined,
      currentText: lines('новая', 'z', 'a', 'B', 'C', 'd', 'E'),
      selection: { from: 1, to: 1 },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'uncommitted', fragment: { left: { from: 1, to: 0 } } });
  });
});

describe('parseFileLog', () => {
  it('изменение, переименование, создание, путь в кавычках', () => {
    const header = (h: string, subject: string) =>
      `\x1e${[h, h.slice(0, 7), '', 'Имя', 'a@b', '1700000000', subject].join('\0')}\n\n`;
    const out =
      header('1'.repeat(40), 'правка') +
      'M\tnew.txt\n' +
      header('2'.repeat(40), 'переименовать') +
      'R087\told.txt\tnew.txt\n' +
      header('3'.repeat(40), 'создать') +
      'A\t"\\321\\204\\tq.txt"\n';
    expect(parseFileLog(out).map(({ pathBefore, pathAfter }) => [pathBefore, pathAfter])).toEqual([
      ['new.txt', 'new.txt'],
      ['old.txt', 'new.txt'],
      [undefined, 'ф\tq.txt'],
    ]);
  });
});

describe('история всего файла', () => {
  let repo: TestRepo;
  const c: Record<string, string> = {};

  beforeAll(() => {
    repo = makeRepo();
    c.create = repo.commit('Создать', { 'f.txt': lines('a', 'b') });
    c.edit = repo.commit('Правка', { 'f.txt': lines('a', 'B') });
    c.unrelated = repo.commit('Другой файл', { 'other.txt': 'x\n' });
    c.rename = repo.commit('Переименовать', { 'f.txt': null, 'dir/g h.txt': lines('a', 'B') });
  });

  afterAll(() => repo.remove());

  it('fileLog: коммиты файла с путями до и после, чужие пропущены', async () => {
    const entries = await fileLog(repo.root, 'dir/g h.txt');
    expect(entries.map((e) => [e.commit.subject, e.pathBefore, e.pathAfter])).toEqual([
      ['Переименовать', 'f.txt', 'dir/g h.txt'],
      ['Правка', 'f.txt', 'f.txt'],
      ['Создать', undefined, 'f.txt'],
    ]);
  });

  it('без выделения: незакоммиченные правки и все коммиты, без фрагмента', async () => {
    const items = await lineHistory({
      root: repo.root,
      path: 'dir/g h.txt',
      headText: lines('a', 'B'),
      currentText: lines('a', 'B', 'новая'),
    });
    expect(items.map((i) => (i.kind === 'commit' ? i.commit.subject : i.kind))).toEqual([
      'uncommitted',
      'Переименовать',
      'Правка',
      'Создать',
    ]);
    expect(items.every((i) => i.fragment === undefined)).toBe(true);
    expect(items[1]).toMatchObject({
      // Родитель переименования — предыдущий коммит репозитория, файл в нём — под старым именем.
      left: { rev: c.unrelated, path: 'f.txt' },
      right: { rev: c.rename, path: 'dir/g h.txt' },
    });
    // Создание: слева родителя нет — «<хеш>^».
    expect(items[3]).toMatchObject({ left: { rev: `${c.create}^` } });
  });

  it('без правок (и с другими переводами строк) — без строки незакоммиченного', async () => {
    const items = await lineHistory({
      root: repo.root,
      path: 'dir/g h.txt',
      headText: lines('a', 'B'),
      currentText: 'a\r\nB\r\n',
    });
    expect(items[0].kind).toBe('commit');
  });

  it('файл не в git — только незакоммиченные', async () => {
    const items = await lineHistory({
      root: repo.root,
      path: 'new.txt',
      headText: undefined,
      currentText: 'x\n',
    });
    expect(items.map((i) => i.kind)).toEqual(['uncommitted']);
  });
});

describe('история строк из влитой ветки', () => {
  let repo: TestRepo;
  const c: Record<string, string> = {};

  beforeAll(() => {
    repo = makeRepo();
    c.create = repo.commit('Создать', { 'f.txt': lines('1', '2', '3') });
    repo.git('checkout', '-q', '-b', 'feature');
    c.add = repo.commit('Добавить строки', { 'f.txt': lines('1', '2', 'new-a', 'new-b', '3') });
    c.fix = repo.commit('Поправить', { 'f.txt': lines('1', '2', 'new-A', 'new-b', '3') });
    repo.git('checkout', '-q', 'main');
    repo.git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge PR');
  });

  afterAll(() => repo.remove());

  it('по умолчанию — коммиты ветки, последний — где строки появились', async () => {
    const entries = await lineLog(repo.root, 'f.txt', { from: 3, to: 4 });
    expect(entries.map((e) => e.commit.subject)).toEqual(['Поправить', 'Добавить строки']);
    // Строки вставлены между 2-й и 3-й: слева пустое место перед строкой 3.
    expect(entries[1]).toMatchObject({
      kind: 'change',
      before: { path: 'f.txt', range: { from: 3, to: 2 } },
      after: { path: 'f.txt', range: { from: 3, to: 4 } },
    });
  });

  it('только первый родитель — merge-коммит не теряется', async () => {
    const entries = await lineLog(repo.root, 'f.txt', { from: 3, to: 4 }, { firstParent: true });
    expect(entries.map((e) => [e.kind, e.commit.subject])).toEqual([['merge', 'Merge PR']]);
    const items = await lineHistory({
      root: repo.root,
      path: 'f.txt',
      headText: lines('1', '2', 'new-A', 'new-b', '3'),
      currentText: lines('1', '2', 'new-A', 'new-b', '3'),
      selection: { from: 3, to: 4 },
      firstParent: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'commit', left: { path: 'f.txt' } });
    expect(items[0].fragment).toBeUndefined();
    // Слева — основная ветка до merge: там этих строк ещё нет.
    const left = items[0].left;
    expect(left.kind === 'rev' && left.rev).toMatch(/\^1$/);
    const before = await fileAtRevision(repo.root, left.kind === 'rev' ? left.rev : '', 'f.txt');
    expect(before).toMatchObject({ text: lines('1', '2', '3') });
  });

  it('merge с изменениями с обеих сторон: в истории строк — те же коммиты, что в истории файла', async () => {
    // main и feature2 меняют разные строки, merge не TREESAME ни одному родителю.
    const r = makeRepo();
    try {
      r.commit('Создать', { 'f.txt': lines('1', '2', '3', '4') });
      r.git('checkout', '-q', '-b', 'feature2');
      r.commit('Ветка: строка 1', { 'f.txt': lines('1!', '2', '3', '4') });
      r.git('checkout', '-q', 'main');
      r.commit('Main: строка 4', { 'f.txt': lines('1', '2', '3', '4!') });
      r.git('merge', '-q', '--no-edit', 'feature2', '-m', 'Merge dev');
      const byLines = await lineLog(r.root, 'f.txt', { from: 1, to: 4 });
      const byFile = await fileLog(r.root, 'f.txt');
      const subjects = (e: { commit: { subject: string } }[]) =>
        e.map((x) => x.commit.subject).sort();
      expect(subjects(byLines)).not.toContain('Merge dev');
      expect(subjects(byLines)).toEqual(subjects(byFile));
    } finally {
      r.remove();
    }
  });

  it('история файла по умолчанию — тоже с коммитами ветки', async () => {
    const entries = await fileLog(repo.root, 'f.txt');
    expect(entries.map((e) => e.commit.subject)).toEqual([
      'Поправить',
      'Добавить строки',
      'Создать',
    ]);
  });
});

describe('merge с правками при разрешении конфликта', () => {
  let repo: TestRepo;
  const c: Record<string, string> = {};

  beforeAll(() => {
    repo = makeRepo();
    c.create = repo.commit('Создать', { 'f.txt': lines('1', '2', '3', '4', '5') });
    repo.git('checkout', '-q', '-b', 'dev');
    c.dev = repo.commit('Dev: строка 2 и 5', { 'f.txt': lines('1', '2-dev', '3', '4', '5-dev') });
    repo.git('checkout', '-q', 'main');
    c.main = repo.commit('Main: строка 2', { 'f.txt': lines('1', '2-main', '3', '4', '5') });
    // Конфликт в строке 2 разрешён третьим вариантом; строка 5 пришла из dev без конфликта.
    try {
      repo.git('merge', '-q', 'dev', '-m', 'Merge dev');
    } catch {
      // ожидаемо: конфликт
    }
    repo.write('f.txt', lines('1', '2-разрешено', '3', '4', '5-dev'));
    repo.git('add', 'f.txt');
    repo.git('commit', '-q', '-m', 'Merge dev');
    c.merge = repo.git('rev-parse', 'HEAD').trim();
  });

  afterAll(() => repo.remove());

  const history = (selection?: { from: number; to: number }) =>
    lineHistory({
      root: repo.root,
      path: 'f.txt',
      headText: lines('1', '2-разрешено', '3', '4', '5-dev'),
      currentText: lines('1', '2-разрешено', '3', '4', '5-dev'),
      selection,
    });
  const subjects = (items: Awaited<ReturnType<typeof history>>) =>
    items.map((i) => (i.kind === 'commit' ? i.commit.subject : i.kind));

  it('ownLines: только строки, которых нет ни в одном родителе', () => {
    expect([
      ...ownLines(lines('1', '2-разрешено', '3', '4', '5-dev'), [
        lines('1', '2-main', '3', '4', '5'),
        lines('1', '2-dev', '3', '4', '5-dev'),
      ]),
    ]).toEqual([1]);
  });

  it('история строк: merge с подсвеченной строкой, слева основная ветка', async () => {
    const items = await history({ from: 2, to: 2 });
    // Время у merge и «Main» в тесте одно — порядок остальных между собой задаёт git.
    expect(subjects(items)[0]).toBe('Merge dev');
    expect(subjects(items).slice(1).sort()).toEqual(
      ['Main: строка 2', 'Dev: строка 2 и 5', 'Создать'].sort(),
    );
    const merge = items[0];
    expect(merge).toMatchObject({
      right: { rev: c.merge },
      fragment: { left: { from: 2, to: 2 }, right: { from: 2, to: 2 } },
    });
    const left = merge.left.kind === 'rev' ? merge.left.rev : '';
    expect(await fileAtRevision(repo.root, left, 'f.txt')).toMatchObject({
      text: lines('1', '2-main', '3', '4', '5'),
    });
  });

  it('история строк, которые merge не правил, — без merge', async () => {
    expect(subjects(await history({ from: 5, to: 5 }))).toEqual(['Dev: строка 2 и 5', 'Создать']);
  });

  it('история файла: merge на своём месте', async () => {
    expect(subjects(await history())).toEqual([
      'Merge dev',
      'Main: строка 2',
      'Dev: строка 2 и 5',
      'Создать',
    ]);
  });

  it('обычный merge (ветки меняли разные строки) — нет ни там, ни там', async () => {
    const r = makeRepo();
    try {
      r.commit('Создать', { 'f.txt': lines('1', '2', '3') });
      r.git('checkout', '-q', '-b', 'dev');
      r.commit('Dev', { 'f.txt': lines('1!', '2', '3') });
      r.git('checkout', '-q', 'main');
      r.commit('Main', { 'f.txt': lines('1', '2', '3!') });
      r.git('merge', '-q', '--no-edit', 'dev', '-m', 'Merge dev');
      const text = lines('1!', '2', '3!');
      const run = (selection?: { from: number; to: number }) =>
        lineHistory({ root: r.root, path: 'f.txt', headText: text, currentText: text, selection });
      expect(subjects(await run({ from: 1, to: 3 }))).not.toContain('Merge dev');
      expect(subjects(await run())).not.toContain('Merge dev');
    } finally {
      r.remove();
    }
  });
});

describe('история одной строки (курсор без выделения)', () => {
  let repo: TestRepo;

  beforeAll(() => {
    repo = makeRepo();
    repo.commit('Создать', { 'f.txt': lines('a', 'b', 'c', 'd', 'e') });
    repo.commit('Правка соседней сверху', { 'f.txt': lines('a', 'B', 'c', 'd', 'e') });
    repo.commit('Правка соседней снизу', { 'f.txt': lines('a', 'B', 'c', 'D', 'e') });
    repo.commit('Правка этой строки', { 'f.txt': lines('a', 'B', 'C', 'D', 'e') });
    repo.commit('Вставка выше', { 'f.txt': lines('0', 'a', 'B', 'C', 'D', 'e') });
  });

  afterAll(() => repo.remove());

  it('selectedLines: пустое выделение — строка курсора', () => {
    const at = (line: number, character: number) => ({ line, character });
    const sel = (a: [number, number], b: [number, number]) => ({ start: at(...a), end: at(...b) });
    expect(selectedLines(sel([3, 2], [3, 2]))).toEqual({ from: 4, to: 4 });
    expect(selectedLines(sel([3, 0], [3, 0]))).toEqual({ from: 4, to: 4 });
    expect(selectedLines(sel([1, 0], [3, 0]))).toEqual({ from: 2, to: 3 });
    expect(selectedLines(sel([1, 2], [3, 1]))).toEqual({ from: 2, to: 4 });
  });

  it('только коммиты, менявшие эту строку; соседние правки не попадают', async () => {
    const text = lines('0', 'a', 'B', 'C', 'D', 'e');
    const items = await lineHistory({
      root: repo.root,
      path: 'f.txt',
      headText: text,
      currentText: text,
      selection: { from: 4, to: 4 }, // «C»
    });
    expect(items.map((i) => (i.kind === 'commit' ? i.commit.subject : i.kind))).toEqual([
      'Правка этой строки',
      'Создать',
    ]);
    expect(items[0].fragment).toEqual({ left: { from: 3, to: 3 }, right: { from: 3, to: 3 } });
  });
});
