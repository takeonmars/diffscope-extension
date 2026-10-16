// Одна колонка: unifiedMergeView из @codemirror/merge (удалённые строки — над изменёнными),
// блоки — по нашему диффу по строкам (lineDiffOverride), без кнопок принятия изменений.
import { getChunks, unifiedMergeView } from '@codemirror/merge';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { lineDiffOverride, navigationTarget, type PreparedDiff } from './model';

export interface UnifiedConfig {
  prepared: PreparedDiff;
  extensions: Extension;
  wholeFile: boolean;
  context: number;
  onCurrentChunk?: (index: number | undefined) => void;
}

const READING_LINE = 1 / 3;

export class UnifiedDiff {
  readonly dom: HTMLElement;
  private readonly view: EditorView;
  private readonly merge = new Compartment();
  private lastNavigated: number | undefined;
  private navigatedScroll: number | undefined;
  private current: number | undefined;
  private frame = 0;

  constructor(
    parent: HTMLElement,
    private readonly config: UnifiedConfig,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'ds-unified';
    parent.append(this.dom);
    this.view = new EditorView({
      parent: this.dom,
      state: EditorState.create({
        doc: config.prepared.docB,
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          // Разделитель свёрнутого участка — по-русски, без склонения (фраза одна на все числа).
          EditorState.phrases.of({ '$ unchanged lines': '⋯ скрыто строк: $' }),
          config.extensions,
          this.merge.of(this.mergeExtension(config.wholeFile)),
        ],
      }),
    });
    this.view.scrollDOM.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scheduleUpdate();
  }

  get chunkCount(): number {
    return this.chunks().length;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.view.destroy();
    this.dom.remove();
  }

  setWholeFile(whole: boolean): void {
    this.view.dispatch({ effects: this.merge.reconfigure(this.mergeExtension(whole)) });
  }

  navigate(dir: 1 | -1): void {
    const s = this.view.scrollDOM;
    const ref = s.scrollTop + s.clientHeight * READING_LINE;
    const index = navigationTarget(this.chunkTops(), ref, dir, this.lastNavigated, this.current);
    if (index === undefined) return;
    s.scrollTop = Math.max(0, this.chunkTops()[index] - s.clientHeight * READING_LINE);
    this.navigatedScroll = s.scrollTop;
    this.lastNavigated = index;
    this.setCurrent(index);
  }

  private mergeExtension(whole: boolean): Extension {
    return unifiedMergeView({
      original: this.config.prepared.docA,
      mergeControls: false,
      gutter: true,
      highlightChanges: true,
      diffConfig: { override: lineDiffOverride },
      // Без изменений — файл целиком.
      collapseUnchanged:
        whole || !this.config.prepared.chunks.length
          ? undefined
          : { margin: this.config.context, minSize: 3 },
    });
  }

  private chunks() {
    return getChunks(this.view.state)?.chunks ?? [];
  }

  /** Верх блока: удалённые строки рисуются виджетом над началом блока в документе B. */
  private chunkTops(): number[] {
    const offset = this.view.documentTop - this.view.scrollDOM.getBoundingClientRect().top;
    return this.chunks().map((c) => {
      const pos = Math.min(c.fromB, this.view.state.doc.length);
      return this.view.lineBlockAt(pos).top + offset + this.view.scrollDOM.scrollTop;
    });
  }

  private onScroll(): void {
    const s = this.view.scrollDOM;
    if (this.navigatedScroll === undefined || Math.abs(s.scrollTop - this.navigatedScroll) >= 1) {
      this.lastNavigated = undefined;
      this.navigatedScroll = undefined;
    }
    this.scheduleUpdate();
  }

  private scheduleUpdate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.lastNavigated !== undefined) return;
      const top = this.view.scrollDOM.scrollTop;
      const index = this.chunkTops().findIndex((t) => t >= top - 2);
      this.setCurrent(index === -1 ? undefined : index);
    });
  }

  private setCurrent(index: number | undefined): void {
    if (index === this.current) return;
    this.current = index;
    this.config.onCurrentChunk?.(index);
  }
}
