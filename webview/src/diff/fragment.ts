// История по строкам: подсветка фрагмента в колонке и нумерация строк со сдвигом — в режиме
// «Только фрагмент» колонка показывает кусок файла, а номера строк — настоящие.
import type { Extension, Text } from '@codemirror/state';
import { Decoration, EditorView, lineNumbers } from '@codemirror/view';
import type { LineRange } from '../../../shared/protocol';

/** Фрагмент — строки с 1 в обеих колонках. */
export interface FragmentConfig {
  a: LineRange;
  b: LineRange;
}

const fragmentLine = Decoration.line({ class: 'ds-fragment' });
const gapBefore = Decoration.line({ class: 'ds-fragment-gap-before' });
const gapAfter = Decoration.line({ class: 'ds-fragment-gap-after' });

/** Рамка слева у строк фрагмента; пустой фрагмент — линия на месте, где он появится. */
export function fragmentHighlight(range: LineRange | undefined, doc: Text): Extension {
  if (!range) return [];
  if (range.to < range.from) {
    const atEnd = range.from > doc.lines;
    const line = doc.line(Math.min(Math.max(range.from, 1), doc.lines));
    return EditorView.decorations.of(
      Decoration.set([(atEnd ? gapAfter : gapBefore).range(line.from)]),
    );
  }
  const ranges = [];
  for (let n = Math.max(range.from, 1); n <= Math.min(range.to, doc.lines); n++) {
    ranges.push(fragmentLine.range(doc.line(n).from));
  }
  return EditorView.decorations.of(Decoration.set(ranges));
}

/** Номера строк со сдвигом: строка 1 колонки показывается как `offset + 1`. */
export function numbering(offset = 0): Extension {
  return offset ? lineNumbers({ formatNumber: (n) => String(n + offset) }) : lineNumbers();
}
