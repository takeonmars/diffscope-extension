import { describe, expect, it } from 'vitest';
import { layoutGraph, type GraphRow } from '../shared/graph';
import { buildTree, treeOrder, treeRows } from '../webview/src/log/fileTree';

/** Коммиты из записи «хеш:родитель,родитель». */
const commits = (...spec: string[]) =>
  spec.map((s) => {
    const [hash, parents = ''] = s.split(':');
    return { hash, parents: parents ? parents.split(',') : [] };
  });

/** Строка графа текстом: точка «*» на дорожке, «|» — проходящие насквозь. */
function draw(rows: GraphRow[]): string[] {
  return rows.map((row) => {
    const width = Math.max(row.width, row.lane + 1);
    const cells = Array.from({ length: width }, () => ' ');
    for (const line of row.lines) {
      if (line.from[1] === 0 && line.to[1] === 2) cells[line.from[0]] = '|';
    }
    cells[row.lane] = '*';
    return cells.join('').trimEnd();
  });
}

describe('layoutGraph', () => {
  it('линейная история — одна дорожка', () => {
    const rows = layoutGraph(commits('c:b', 'b:a', 'a'));
    expect(draw(rows)).toEqual(['*', '*', '*']);
    expect(new Set(rows.map((r) => r.color))).toEqual(new Set([0]));
  });

  it('ветка и merge: вторая дорожка, сходится в точку ответвления', () => {
    // m — merge main(b) и feature(f); f ответвилась от a.
    const rows = layoutGraph(commits('m:b,f', 'f:a', 'b:a', 'a'));
    expect(draw(rows)).toEqual(['*', '|*', '*|', '*']);
    // merge: линия ко второму родителю на новую дорожку другого цвета
    expect(rows[0].lines).toContainEqual({ from: [0, 1], to: [1, 2], color: 1 });
    // a: дорожка feature сходится в точку на дорожке 0
    expect(rows[3].lines).toContainEqual({ from: [1, 0], to: [0, 1], color: 1 });
    expect(rows[3].width).toBe(2);
  });

  it('две вершины веток — у каждой свой цвет; ответвление от общего коммита', () => {
    const rows = layoutGraph(commits('x:a', 'y:a', 'a'));
    expect(draw(rows)).toEqual(['*', '|*', '*']);
    expect(rows[0].color).not.toBe(rows[1].color);
  });

  it('освободившаяся дорожка используется снова, граф не растёт вширь', () => {
    const rows = layoutGraph(commits('m2:m1,g', 'g:m1', 'm1:b,f', 'f:a', 'b:a', 'a'));
    expect(Math.max(...rows.map((r) => r.width))).toBe(2);
  });

  it('octopus-merge — три дорожки', () => {
    const rows = layoutGraph(commits('o:a,b,c', 'c:r', 'b:r', 'a:r', 'r'));
    expect(rows[0].lines.filter((l) => l.from[1] === 1).map((l) => l.to[0])).toEqual([0, 1, 2]);
    expect(draw(rows)[4]).toBe('*');
  });

  it('несколько корней — у каждого своя дорожка до конца', () => {
    const rows = layoutGraph(commits('m:a,z', 'z', 'a'));
    expect(draw(rows)).toEqual(['*', '|*', '*']);
  });

  it('родитель за пределами порции — дорожка уходит вниз', () => {
    const rows = layoutGraph(commits('b:a'));
    expect(rows[0].lines).toEqual([{ from: [0, 1], to: [0, 2], color: 0 }]);
  });
});

describe('дерево файлов коммита', () => {
  const file = (path: string) => ({ path, status: 'modified' });

  it('папки первыми, цепочки сжаты; порядок «следующего файла» — как в дереве', () => {
    const files = [file('src/z.ts'), file('README.md'), file('src/big/a.ts'), file('docs/x/y.md')];
    const tree = buildTree(files);
    expect(treeRows(tree, new Set()).map((r) => `${'  '.repeat(r.depth)}${r.node.name}`)).toEqual([
      'docs/x',
      '  y.md',
      'src',
      '  big',
      '    a.ts',
      '  z.ts',
      'README.md',
    ]);
    expect(treeOrder(tree)).toEqual([3, 2, 0, 1]);
    expect(treeRows(tree, new Set(['src'])).map((r) => r.node.name)).toEqual([
      'docs/x',
      'y.md',
      'src',
      'README.md',
    ]);
  });
});
