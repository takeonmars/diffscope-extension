// Режим MergeView: две колонки выровнены (напротив вставки — пустое место), прокрутка общая,
// лент нет. Блоки — по нашему диффу по строкам, подсветка — та же, что у «Лент»; полосы у номеров
// строк — от MergeView.
import { MergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { fragmentHighlight, numbering, type FragmentConfig } from './fragment';
import { attachSplitter, clampSplit, DEFAULT_SPLIT } from './splitter';
import { chunkHighlight } from './highlight';
import { lineDiffOverride, navigationTarget, type PreparedDiff } from '../../../shared/diffModel';

export interface AlignedConfig {
  prepared: PreparedDiff;
  extensions: Extension;
  wholeFile: boolean;
  context: number;
  /** Сдвиг номеров строк колонок (режим «Только фрагмент»). */
  lineOffset?: { a: number; b: number };
  /** История по строкам: фрагмент подсвечивается, дифф прокручивается к нему. */
  fragment?: FragmentConfig;
  /** Доля ширины левой колонки. */
  split?: number;
  /** Разделитель отпустили — запомнить долю. */
  onSplitChange?: (ratio: number) => void;
  onCurrentChunk?: (index: number | undefined) => void;
}

const READING_LINE = 1 / 3;

export class AlignedDiff {
  private readonly merge: MergeView;
  private lastNavigated: number | undefined;
  private navigatedScroll: number | undefined;
  private current: number | undefined;
  private frame = 0;
  private readonly editors: HTMLElement[];
  private readonly detachSplitter: () => void;

  constructor(
    parent: HTMLElement,
    private readonly config: AlignedConfig,
  ) {
    const { docA, docB } = config.prepared;
    const base = [
      EditorState.readOnly.of(true),
      EditorState.phrases.of({ '$ unchanged lines': '⋯ скрыто строк: $' }),
      config.extensions,
    ];
    this.merge = new MergeView({
      a: { doc: docA, extensions: [base, this.side('a')] },
      b: { doc: docB, extensions: [base, this.side('b')] },
      parent,
      gutter: true,
      highlightChanges: false,
      diffConfig: { override: lineDiffOverride },
      collapseUnchanged: this.collapse(config.wholeFile),
    });
    this.merge.dom.classList.add('ds-aligned');
    // Разделитель между колонками MergeView: тянется, двойной клик — поровну.
    this.editors = [...this.merge.dom.querySelectorAll<HTMLElement>('.cm-mergeViewEditor')];
    const handle = document.createElement('div');
    handle.className = 'ds-splitter';
    handle.title = 'Потяните, чтобы изменить ширину колонок; двойной клик — поровну';
    this.editors[1].before(handle);
    this.setSplit(config.split ?? DEFAULT_SPLIT);
    this.detachSplitter = attachSplitter(
      handle,
      this.merge.dom,
      (ratio) => this.setSplit(ratio),
      (ratio) => config.onSplitChange?.(ratio),
    );
    this.merge.dom.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scheduleUpdate();
    const fragment = config.fragment;
    if (fragment) requestAnimationFrame(() => this.revealLine(fragment.b.from));
  }

  /** Строка (с 1) правой колонки — на линию чтения; колонки выровнены, левая встанет рядом. */
  revealLine(line: number): void {
    const b = this.merge.b;
    const pos = b.state.doc.line(Math.min(Math.max(line, 1), b.state.doc.lines)).from;
    const offset =
      b.documentTop - this.merge.dom.getBoundingClientRect().top + this.merge.dom.scrollTop;
    this.merge.dom.scrollTop = Math.max(
      0,
      b.lineBlockAt(pos).top + offset - this.merge.dom.clientHeight * READING_LINE,
    );
  }

  private side(side: 'a' | 'b') {
    const { prepared, lineOffset, fragment } = this.config;
    const doc = side === 'a' ? prepared.docA : prepared.docB;
    return [
      numbering(lineOffset?.[side]),
      chunkHighlight(side, prepared.chunks, doc),
      fragmentHighlight(fragment?.[side], doc),
    ];
  }

  get chunkCount(): number {
    return this.merge.chunks.length;
  }

  /** Доля ширины левой колонки; длинные строки прокручиваются внутри своей колонки. */
  setSplit(ratio: number): void {
    const r = clampSplit(ratio);
    this.editors[0].style.flex = `${r} 1 0`;
    this.editors[1].style.flex = `${1 - r} 1 0`;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.detachSplitter();
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
