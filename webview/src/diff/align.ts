// Пустые вставки для выравнивания колонок при общей прокрутке (вкладка «все файлы»): перед
// строкой — блок высотой в N строк. Где и сколько — alignmentPads в shared/diffModel.
import type { Extension, Range, Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

class Spacer extends WidgetType {
  constructor(readonly lines: number) {
    super();
  }

  eq(other: Spacer): boolean {
    return other.lines === this.lines;
  }

  toDOM(): HTMLElement {
    const dom = document.createElement('div');
    dom.className = 'ds-align-spacer';
    // Высота строки — 1.5 размера шрифта (тема CodeMirror), перенос строк выключен.
    dom.style.height = `${this.lines * 1.5}em`;
    return dom;
  }

  get estimatedHeight(): number {
    return this.lines * 20;
  }
}

/** `pads`: индекс строки (с 0; = число строк — после последней) → сколько пустых строк вставить. */
export function alignSpacers(pads: ReadonlyMap<number, number>, doc: Text): Extension {
  const ranges: Range<Decoration>[] = [];
  for (const [line, lines] of pads) {
    if (lines <= 0) continue;
    const atEnd = line >= doc.lines;
    const pos = atEnd ? doc.length : doc.line(line + 1).from;
    ranges.push(
      Decoration.widget({ widget: new Spacer(lines), block: true, side: atEnd ? 1 : -1 }).range(
        pos,
      ),
    );
  }
  return EditorView.decorations.of(Decoration.set(ranges, true));
}
