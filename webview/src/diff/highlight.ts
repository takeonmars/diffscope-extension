// Подсветка блоков изменений в одной колонке: фон изменённых строк, изменения внутри строк,
// линия-граница на стороне, где блок пустой (сюда вставлено / отсюда удалено).
import type { Extension, Range, Text } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { LineChunk, Side } from '../../../shared/diffModel';

// Документы только для чтения — подсветка считается один раз.
export function chunkHighlight(side: Side, chunks: readonly LineChunk[], doc: Text): Extension {
  const ranges: Range<Decoration>[] = [];
  for (const c of chunks) {
    const [from, to] = side === 'a' ? [c.aFrom, c.aTo] : [c.bFrom, c.bTo];
    if (from === to) {
      // Пустая сторона: граница перед строкой from или после последней строки.
      const atEnd = from >= doc.lines;
      const line = doc.line(atEnd ? doc.lines : from + 1);
      const cls = `ds-boundary ds-boundary-${atEnd ? 'after' : 'before'} ds-${c.kind}`;
      ranges.push(lineDeco(cls).range(line.from));
      continue;
    }
    for (let i = from; i < to; i++) {
      ranges.push(lineDeco(`ds-line ds-${c.kind}`).range(doc.line(i + 1).from));
    }
    for (const change of c.inline) {
      const [start, end] = side === 'a' ? [change.fromA, change.toA] : [change.fromB, change.toB];
      if (start < end) ranges.push(inlineMark.range(start, end));
    }
  }
  return EditorView.decorations.of(Decoration.set(ranges, true));
}

const lineDecos = new Map<string, Decoration>();
function lineDeco(cls: string): Decoration {
  let deco = lineDecos.get(cls);
  if (!deco) lineDecos.set(cls, (deco = Decoration.line({ class: cls })));
  return deco;
}

const inlineMark = Decoration.mark({ class: 'ds-inline' });
