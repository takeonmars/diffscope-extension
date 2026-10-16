// Сворачивание неизменённых участков в одной колонке. Свёрнутый участок заменяется
// разделителем «⋯ N строк скрыто»; клик раскрывает его (в обеих колонках — через onExpand).
import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { CollapsedRegion, Side } from '../../../shared/diffModel';

/** Какие участки (по id) сейчас свёрнуты. */
export const setCollapsed = StateEffect.define<ReadonlySet<number>>();

export function collapseUnchanged(
  side: Side,
  regions: readonly CollapsedRegion[],
  initial: ReadonlySet<number>,
  onExpand: (id: number) => void,
): Extension {
  const build = (doc: Text, collapsed: ReadonlySet<number>): DecorationSet => {
    const ranges = [];
    for (const region of regions) {
      if (!collapsed.has(region.id)) continue;
      const [from, to] = side === 'a' ? [region.aFrom, region.aTo] : [region.bFrom, region.bTo];
      const widget = new CollapsedWidget(region.id, to - from, onExpand);
      ranges.push(
        Decoration.replace({ widget, block: true }).range(doc.line(from + 1).from, doc.line(to).to),
      );
    }
    return Decoration.set(ranges);
  };

  return StateField.define<DecorationSet>({
    create: (state) => build(state.doc, initial),
    update(value, tr) {
      for (const effect of tr.effects)
        if (effect.is(setCollapsed)) return build(tr.state.doc, effect.value);
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

class CollapsedWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly lines: number,
    readonly onExpand: (id: number) => void,
  ) {
    super();
  }

  eq(other: CollapsedWidget): boolean {
    return other.id === this.id && other.lines === this.lines;
  }

  toDOM(): HTMLElement {
    const dom = document.createElement('div');
    dom.className = 'ds-collapsed';
    dom.title = 'Показать';
    dom.textContent = `⋯ ${linesText(this.lines)} скрыто`;
    dom.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.onExpand(this.id);
    });
    return dom;
  }

  get estimatedHeight(): number {
    return 24;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function linesText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'строка'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'строки'
        : 'строк';
  return `${n} ${word}`;
}
