import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  buildLineChunks,
  collapsedRegions,
  diffStats,
  lineDiffOverride,
  mapPosition,
  navigationTarget,
  nextChunkIndex,
  ribbonPath,
  statsBlocks,
  type LineChunk,
} from '../webview/src/diff/model';

const doc = (...lines: string[]) => Text.of(lines);
const ranges = (chunks: LineChunk[]) =>
  chunks.map(({ aFrom, aTo, bFrom, bTo, kind }) => ({ aFrom, aTo, bFrom, bTo, kind }));
const chunk = (aFrom: number, aTo: number, bFrom: number, bTo: number) =>
  ({ aFrom, aTo, bFrom, bTo, kind: 'modified', inline: [] }) as LineChunk;

describe('buildLineChunks', () => {
  it('изменённая строка', () => {
    expect(ranges(buildLineChunks(doc('a', 'b', 'c'), doc('a', 'B', 'c')))).toEqual([
      { aFrom: 1, aTo: 2, bFrom: 1, bTo: 2, kind: 'modified' },
    ]);
  });

  it('добавленные строки в середине', () => {
    expect(ranges(buildLineChunks(doc('a', 'c'), doc('a', 'b1', 'b2', 'c')))).toEqual([
      { aFrom: 1, aTo: 1, bFrom: 1, bTo: 3, kind: 'inserted' },
    ]);
  });

  it('удалённая строка в начале', () => {
    expect(ranges(buildLineChunks(doc('x', 'a', 'b'), doc('a', 'b')))).toEqual([
      { aFrom: 0, aTo: 1, bFrom: 0, bTo: 0, kind: 'deleted' },
    ]);
  });

  it('добавленные и удалённые строки в конце', () => {
    expect(ranges(buildLineChunks(doc('a', 'b'), doc('a', 'b', 'c', 'd')))).toEqual([
      { aFrom: 2, aTo: 2, bFrom: 2, bTo: 4, kind: 'inserted' },
    ]);
    expect(ranges(buildLineChunks(doc('a', 'b', 'c'), doc('a')))).toEqual([
      { aFrom: 1, aTo: 3, bFrom: 1, bTo: 1, kind: 'deleted' },
    ]);
  });

  it('соседние изменения через общую строку — два блока', () => {
    const a = doc('function f() {', '  return 1;', '}', '', 'const x = 1;');
    const b = doc('', 'const x = 2;');
    expect(ranges(buildLineChunks(a, b))).toEqual([
      { aFrom: 0, aTo: 3, bFrom: 0, bTo: 0, kind: 'deleted' },
      { aFrom: 4, aTo: 5, bFrom: 1, bTo: 2, kind: 'modified' },
    ]);
  });

  it('изменения внутри строк — в позициях документов', () => {
    const a = doc('one', 'const x = 1;');
    const b = doc('one', 'const x = 42;');
    const [c] = buildLineChunks(a, b);
    expect(c.inline.length).toBeGreaterThan(0);
    for (const change of c.inline) {
      expect(a.sliceString(change.fromA, change.toA)).toMatch(/^1?$/);
      expect(b.sliceString(change.fromB, change.toB)).toMatch(/^(4|2|42)?$/);
    }
  });

  it('одинаковые документы — нет блоков', () => {
    expect(buildLineChunks(doc('a', 'b'), doc('a', 'b'))).toEqual([]);
  });
});

describe('collapsedRegions', () => {
  it('сворачивает всё, кроме контекста вокруг блоков', () => {
    // 30 строк слева; блок на строках 10–11, справа на его месте 3 строки.
    const regions = collapsedRegions([chunk(10, 12, 10, 13)], 30, 4);
    expect(regions).toEqual([
      { id: 0, aFrom: 0, aTo: 6, bFrom: 0, bTo: 6 },
      { id: 1, aFrom: 16, aTo: 30, bFrom: 17, bTo: 31 },
    ]);
  });

  it('короткие участки между блоками не сворачиваются', () => {
    const regions = collapsedRegions([chunk(5, 6, 5, 6), chunk(14, 15, 14, 15)], 20, 4);
    // Между блоками 8 строк — все в контексте; в начале 1 строка, в конце — 1.
    expect(regions).toEqual([]);
  });

  it('файлы совпадают — один участок на весь файл', () => {
    expect(collapsedRegions([], 50, 4)).toEqual([{ id: 0, aFrom: 0, aTo: 50, bFrom: 0, bTo: 50 }]);
  });
});

describe('mapPosition', () => {
  // Слева строки 0..9; справа на месте строк 2–3 стало 4 строки, а после строки 6 добавлены 2.
  const chunks = [chunk(2, 4, 2, 6), chunk(7, 7, 9, 11)];

  it('до первого блока — без сдвига', () => {
    expect(mapPosition(chunks, 1.5, 'a')).toBe(1.5);
  });

  it('внутри блока — пропорционально', () => {
    expect(mapPosition(chunks, 3, 'a')).toBe(4);
    expect(mapPosition(chunks, 4, 'b')).toBe(3);
  });

  it('между блоками — сдвиг на разницу размеров', () => {
    expect(mapPosition(chunks, 5, 'a')).toBe(7);
    expect(mapPosition(chunks, 7, 'b')).toBe(5);
  });

  it('пустая сторона блока перепрыгивается', () => {
    expect(mapPosition(chunks, 7, 'a')).toBe(11);
    expect(mapPosition(chunks, 10, 'b')).toBe(7);
  });

  it('без блоков — та же позиция', () => {
    expect(mapPosition([], 42.25, 'b')).toBe(42.25);
  });
});

describe('nextChunkIndex', () => {
  const tops = [100, 300, 500, 700];

  it('следующий — первый ниже линии чтения', () => {
    expect(nextChunkIndex(tops, 0, 1)).toBe(0);
    expect(nextChunkIndex(tops, 300, 1)).toBe(2);
    expect(nextChunkIndex(tops, 800, 1)).toBeUndefined();
  });

  it('предыдущий — последний выше линии чтения', () => {
    expect(nextChunkIndex(tops, 500, -1)).toBe(1);
    expect(nextChunkIndex(tops, 50, -1)).toBeUndefined();
  });

  it('в конце файла идёт дальше от прошлого блока', () => {
    // Прокрутка упёрлась: блок 2 выше линии чтения не поднялся.
    expect(nextChunkIndex(tops, 400, 1, 2)).toBe(3);
    expect(nextChunkIndex(tops, 800, 1, 2)).toBe(3);
    expect(nextChunkIndex(tops, 800, 1, 3)).toBeUndefined();
  });
});

describe('ribbonPath', () => {
  it('замкнутая фигура от левого края к правому', () => {
    expect(ribbonPath(40, 10, 30, 50, 90)).toBe(
      'M0,10 C20,10 20,50 40,50 L40,90 C20,90 20,30 0,30 Z',
    );
  });
});

describe('toCharChanges', () => {
  // Применение изменений к A должно давать B — иначе одна колонка покажет не то.
  const apply = (a: string, b: string) => {
    let result = '';
    let pos = 0;
    for (const ch of lineDiffOverride(a, b)) {
      result += a.slice(pos, ch.fromA) + b.slice(ch.fromB, ch.toB);
      pos = ch.toA;
    }
    return result + a.slice(pos);
  };
  const cases: [string, string, string][] = [
    ['изменённая строка', 'a\nb\nc', 'a\nB\nc'],
    ['вставка в середине', 'a\nc', 'a\nb1\nb2\nc'],
    ['вставка в начале', 'b\nc', 'a\nb\nc'],
    ['вставка в конце', 'a\nb', 'a\nb\nc\nd'],
    ['удаление в начале', 'x\na\nb', 'a\nb'],
    ['удаление в конце', 'a\nb\nc', 'a'],
    ['замена всего', 'one', 'x\ny'],
    ['из пустого', '', 'a\nb'],
    ['в пустой', 'a\nb', ''],
    ['перевод строки в конце', 'a\nb\n', 'a\nB\nc\n'],
    ['несколько блоков', 'a\nb\nc\nd\ne\nf', 'a\nB\nc\nd\nf\ng'],
  ];
  for (const [name, a, b] of cases) {
    it(name, () => {
      expect(apply(a, b)).toBe(b);
    });
  }

  it('блоки CodeMirror совпадают с нашими', () => {
    // Блоки через пустую строку CodeMirror склеивает (между ними 0 символов) — здесь обычная.
    const a = 'function f() {\n  return 1;\n}\nkeep\nconst x = 1;\n';
    const b = 'keep\nconst x = 2;\n';
    const A = Text.of(a.split('\n'));
    const B = Text.of(b.split('\n'));
    expect(buildLineChunks(A, B)).toHaveLength(2);
    expect(Chunk.build(A, B, { override: lineDiffOverride })).toHaveLength(2);
  });
});

describe('сводка изменений', () => {
  it('изменённая строка — удалена и добавлена', () => {
    expect(diffStats([chunk(0, 2, 0, 3), chunk(5, 5, 6, 8), chunk(9, 10, 11, 11)])).toEqual({
      added: 5,
      removed: 3,
    });
  });

  it('квадратики как на GitHub', () => {
    expect(statsBlocks(0, 0)).toEqual({ added: 0, removed: 0, neutral: 5 });
    expect(statsBlocks(10, 0)).toEqual({ added: 5, removed: 0, neutral: 0 });
    expect(statsBlocks(60, 40)).toEqual({ added: 3, removed: 2, neutral: 0 });
    expect(statsBlocks(1, 1)).toEqual({ added: 1, removed: 1, neutral: 3 });
    // Малая доля не пропадает.
    expect(statsBlocks(100, 1)).toEqual({ added: 4, removed: 1, neutral: 0 });
    expect(statsBlocks(1, 100)).toEqual({ added: 1, removed: 4, neutral: 0 });
  });
});

describe('navigationTarget', () => {
  const tops = [100, 300, 500, 700];

  it('от счётчика — ровно на один блок', () => {
    expect(navigationTarget(tops, 400, 1, undefined, 1)).toBe(2);
    expect(navigationTarget(tops, 400, -1, undefined, 2)).toBe(1);
    expect(navigationTarget(tops, 400, 1, 2, 0)).toBe(3);
  });

  it('текущий блок ниже линии чтения — сначала он сам', () => {
    expect(navigationTarget(tops, 50, 1, undefined, 0)).toBe(0);
  });

  it('на краях — никуда', () => {
    expect(navigationTarget(tops, 0, 1, 3, 3)).toBeUndefined();
    expect(navigationTarget(tops, 0, -1, 0, 0)).toBeUndefined();
  });

  it('без текущего — по положению', () => {
    expect(navigationTarget(tops, 800, -1, undefined, undefined)).toBe(3);
  });
});
