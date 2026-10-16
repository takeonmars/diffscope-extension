// Режим MergeView: две колонки выровнены (напротив вставки — пустое место), прокрутка общая,
// лент нет. Блоки — по нашему диффу по строкам, подсветка — та же, что у «Лент»; полосы у номеров
// строк — от MergeView.
import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { lineNumbers } from '@codemirror/view';
import { chunkHighlight } from './highlight';
import { lineDiffOverride, navigationTarget, type PreparedDiff } from './model';

export interface AlignedConfig {
  prepared: PreparedDiff;
  extensions: Extension;
  wholeFile: boolean;
  context: number;
  onCurrentChunk?: (index: number | undefined) => void;
}

const READING_LINE = 1 / 3;

export class AlignedDiff {
  private readonly merge: MergeView;
  private lastNavigated: number | undefined;
  private navigatedScroll: number | undefined;
  private current: number | undefined;
  private frame = 0;

  constructor(
    parent: HTMLElement,
    private readonly config: AlignedConfig,
  ) {
    const { docA, docB, chunks } = config.prepared;
    const base = [
      lineNumbers(),
      EditorState.readOnly.of(true),
      EditorState.phrases.of({ '$ unchanged lines': '⋯ скрыто строк: $' }),
      config.extensions,
    ];
    this.merge = new MergeView({
      a: { doc: docA, extensions: [base, chunkHighlight('a', chunks, docA)] },
      b: { doc: docB, extensions: [base, chunkHighlight('b', chunks, docB)] },
      parent,
      gutter: true,
      highlightChanges: false,
      diffConfig: { override: lineDiffOverride },
      collapseUnchanged: this.collapse(config.wholeFile),
    });
    this.merge.dom.classList.add('ds-aligned');
    this.merge.dom.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scheduleUpdate();
  }

  get chunkCount(): number {
    return this.merge.chunks.length;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.merge.destroy();
  }

  setWholeFile(whole: boolean): void {
    this.merge.reconfigure({ collapseUnchanged: this.collapse(whole) });
  }

  navigate(dir: 1 | -1): void {
    const scroller = this.merge.dom;
    const tops = this.chunkTops();
    const ref = scroller.scrollTop + scroller.clientHeight * READING_LINE;
    const index = navigationTarget(tops, ref, dir, this.lastNavigated, this.current);
    if (index === undefined) return;
    scroller.scrollTop = Math.max(0, tops[index] - scroller.clientHeight * READING_LINE);
    this.navigatedScroll = scroller.scrollTop;
    this.lastNavigated = index;
    this.setCurrent(index);
  }

  private collapse(whole: boolean) {
    // Без изменений — файл целиком.
    const nothing = !this.config.prepared.chunks.length;
    return whole || nothing ? undefined : { margin: this.config.context, minSize: 3 };
  }

  /** Верх блоков в координатах прокрутки; колонки выровнены — достаточно правой. */
  private chunkTops(): number[] {
    const b = this.merge.b;
    const offset =
      b.documentTop - this.merge.dom.getBoundingClientRect().top + this.merge.dom.scrollTop;
    return this.merge.chunks.map(
      (c) => b.lineBlockAt(Math.min(c.fromB, b.state.doc.length)).top + offset,
    );
  }

  private onScroll(): void {
    const top = this.merge.dom.scrollTop;
    if (this.navigatedScroll === undefined || Math.abs(top - this.navigatedScroll) >= 1) {
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
      const top = this.merge.dom.scrollTop;
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
