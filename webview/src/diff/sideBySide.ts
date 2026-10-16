// Две колонки диффа как в WebStorm: два независимых редактора без выравнивания, между ними —
// SVG с лентами, соединяющими соответствующие блоки; прокрутка синхронизируется по блокам.
// Неизменённые участки сворачиваются; навигация по блокам; метки блоков у полос прокрутки.
import { EditorState, type Extension, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { fragmentHighlight, numbering, type FragmentConfig } from './fragment';
import { attachSplitter, clampSplit, DEFAULT_SPLIT, GAP_WIDTH } from './splitter';
import { collapseUnchanged, setCollapsed } from './collapse';
import { chunkHighlight } from './highlight';
import {
  collapsedRegions,
  mapPosition,
  navigationTarget,
  ribbonPath,
  type CollapsedRegion,
  type LineChunk,
  type PreparedDiff,
  type Side,
} from '../../../shared/diffModel';

export interface SideBySideConfig {
  prepared: PreparedDiff;
  /** Общие расширения обеих колонок: тема, язык. */
  extensions: Extension;
  /** Показывать весь файл (иначе неизменённое свёрнуто). */
  wholeFile: boolean;
  /** Строк контекста вокруг изменений при свёрнутом неизменённом. */
  context: number;
  /** Сдвиг номеров строк колонок (режим «Только фрагмент»). */
  lineOffset?: { a: number; b: number };
  /** История по строкам: фрагмент подсвечивается, дифф прокручивается к нему. */
  fragment?: FragmentConfig;
  /** Доля ширины левой колонки. */
  split?: number;
  /** Разделитель отпустили — запомнить долю. */
  onSplitChange?: (ratio: number) => void;
  /** Текущий блок (у линии чтения или последний выбранный навигацией) изменился. */
  onCurrentChunk?: (index: number | undefined) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Линия чтения — доля высоты экрана: сюда ставится блок при навигации. */
const READING_LINE = 1 / 3;

export class SideBySideDiff {
  readonly dom: HTMLElement;
  readonly chunks: readonly LineChunk[];

  private readonly a: EditorView;
  private readonly b: EditorView;
  private readonly gap: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly rulers: Record<Side, HTMLElement>;
  private readonly regions: readonly CollapsedRegion[];
  private collapsed: Set<number>;
  /** scrollTop, выставленный программно: его событие scroll не синхронизирует другую колонку. */
  private readonly expectedScroll = new Map<Side, number>();
  /** Блок, к которому перешли навигацией; сбрасывается, когда пользователь прокручивает сам. */
  private lastNavigated: number | undefined;
  private current: number | undefined;
  private readonly onCurrentChunk?: (index: number | undefined) => void;
  private readonly resizeObserver: ResizeObserver;
  private frame = 0;
  private readonly detachSplitter: () => void;
  private rulersDirty = true;

  constructor(parent: HTMLElement, config: SideBySideConfig) {
    const { docA, docB, chunks } = config.prepared;
    this.chunks = chunks;
    // Без изменений смотреть нечего — файл показывается целиком, сворачивать нечего.
    const fragment = config.fragment;
    // Фрагмент истории не сворачивается: участки, которые его задевают, остаются раскрытыми.
    this.regions = (
      chunks.length ? collapsedRegions(chunks, docA.lines, config.context) : []
    ).filter(
      (r) =>
        !fragment ||
        ((r.aTo < fragment.a.from - 1 || r.aFrom > fragment.a.to) &&
          (r.bTo < fragment.b.from - 1 || r.bFrom > fragment.b.to)),
    );
    this.collapsed = new Set(config.wholeFile ? [] : this.regions.map((r) => r.id));
    this.onCurrentChunk = config.onCurrentChunk;

    this.dom = el('div', 'ds-sbs');
    const paneA = el('div', 'ds-sbs__pane');
    this.gap = el('div', 'ds-sbs__gap');
    const paneB = el('div', 'ds-sbs__pane');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.gap.append(this.svg);
    this.rulers = { a: el('div', 'ds-ruler'), b: el('div', 'ds-ruler') };
    this.dom.append(paneA, this.gap, paneB);
    this.dom.style.setProperty('--ds-gap-width', `${GAP_WIDTH}px`);
    this.setSplit(config.split ?? DEFAULT_SPLIT);
    // Промежуток с лентами — он же разделитель колонок.
    this.gap.title = 'Потяните, чтобы изменить ширину колонок; двойной клик — поровну';
    this.detachSplitter = attachSplitter(
      this.gap,
      this.dom,
      (ratio) => this.setSplit(ratio),
      (ratio) => config.onSplitChange?.(ratio),
    );
    parent.append(this.dom);

    const redraw = EditorView.updateListener.of((update) => {
      if (update.geometryChanged || update.heightChanged) this.rulersDirty = true;
      if (update.geometryChanged || update.viewportChanged || update.heightChanged) {
        this.scheduleDraw();
      }
    });
    const editor = (doc: Text, side: Side, pane: HTMLElement) => {
      const host = el('div', 'ds-sbs__editor');
      pane.append(host, this.rulers[side]);
      return new EditorView({
        parent: host,
        state: EditorState.create({
          doc,
          extensions: [
            numbering(config.lineOffset?.[side]),
            EditorState.readOnly.of(true),
            fragmentHighlight(config.fragment?.[side], doc),
            config.extensions,
            chunkHighlight(side, this.chunks, doc),
            collapseUnchanged(side, this.regions, this.collapsed, (id) => this.expand(id)),
            redraw,
          ],
        }),
      });
    };
    this.a = editor(docA, 'a', paneA);
    this.b = editor(docB, 'b', paneB);

    this.a.scrollDOM.addEventListener('scroll', () => this.onScroll('a'), { passive: true });
    this.b.scrollDOM.addEventListener('scroll', () => this.onScroll('b'), { passive: true });
    this.resizeObserver = new ResizeObserver(() => {
      this.rulersDirty = true;
      this.scheduleDraw();
    });
    this.resizeObserver.observe(this.dom);
    this.scheduleDraw();
    if (fragment) requestAnimationFrame(() => this.revealLines(fragment.a.from, fragment.b.from));
  }

  /** Строки (с 1) обеих колонок — на линию чтения. */
  revealLines(lineA: number, lineB: number): void {
    for (const [side, line] of [
      ['a', lineA],
      ['b', lineB],
    ] as const) {
      const view = this.view(side);
      const s = view.scrollDOM;
      const index = Math.min(Math.max(line - 1, 0), view.state.doc.lines);
      const target =
        boundaryHeight(view, index) + documentOffset(view) - s.clientHeight * READING_LINE;
      s.scrollTop = Math.max(0, target);
      this.expectedScroll.set(side, s.scrollTop);
    }
    this.scheduleDraw();
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  /** Доля ширины левой колонки (промежуток с лентами — между ними). */
  setSplit(ratio: number): void {
    const r = clampSplit(ratio);
    this.dom.style.gridTemplateColumns = `minmax(0, ${r}fr) ${GAP_WIDTH}px minmax(0, ${1 - r}fr)`;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.detachSplitter();
    this.resizeObserver.disconnect();
    this.a.destroy();
    this.b.destroy();
    this.dom.remove();
  }

  private view(side: Side): EditorView {
    return side === 'a' ? this.a : this.b;
  }

  // --- Сворачивание ---

  /** Весь файл или только изменения с контекстом. Верхняя видимая строка остаётся на месте. */
  setWholeFile(whole: boolean): void {
    const next = new Set(whole ? [] : this.regions.map((r) => r.id));
    if (sameSet(next, this.collapsed)) return;
    const top = positionAtHeight(this.a, this.a.scrollDOM.scrollTop - documentOffset(this.a));
    this.collapsed = next;
    const anchor = (side: Side, pos: number) => {
      const view = this.view(side);
      const line = view.state.doc.line(Math.min(Math.floor(pos), view.state.doc.lines - 1) + 1);
      return EditorView.scrollIntoView(line.from, { y: 'start' });
    };
    this.a.dispatch({ effects: [setCollapsed.of(next), anchor('a', top)] });
    this.b.dispatch({
      effects: [setCollapsed.of(next), anchor('b', mapPosition(this.chunks, top, 'a'))],
    });
  }

  private expand(id: number): void {
    if (!this.collapsed.delete(id)) return;
    const next = new Set(this.collapsed);
    this.a.dispatch({ effects: setCollapsed.of(next) });
    this.b.dispatch({ effects: setCollapsed.of(next) });
  }

  // --- Навигация ---

  /** Переход к следующему (1) или предыдущему (-1) блоку; блок встаёт на линию чтения. */
  navigate(dir: 1 | -1): void {
    const s = this.a.scrollDOM;
    const ref = s.scrollTop + s.clientHeight * READING_LINE - documentOffset(this.a);
    const index = navigationTarget(this.chunkTops(), ref, dir, this.lastNavigated, this.current);
    if (index !== undefined) this.goTo(index);
  }

  goTo(index: number): void {
    const c = this.chunks[index];
    for (const side of ['a', 'b'] as const) {
      const view = this.view(side);
      const s = view.scrollDOM;
      const top = boundaryHeight(view, side === 'a' ? c.aFrom : c.bFrom);
      const target = top + documentOffset(view) - s.clientHeight * READING_LINE;
      s.scrollTop = Math.max(0, target);
      this.expectedScroll.set(side, s.scrollTop);
    }
    this.lastNavigated = index;
    this.setCurrent(index);
    this.scheduleDraw();
  }

  private chunkTops(): number[] {
    return this.chunks.map((c) => boundaryHeight(this.a, c.aFrom));
  }

  private setCurrent(index: number | undefined): void {
    if (index === this.current) return;
    this.current = index;
    this.onCurrentChunk?.(index);
  }

  /** Текущий блок при обычной прокрутке — первый, видимый хотя бы частично. */
  private updateCurrent(): void {
    if (this.lastNavigated !== undefined) return;
    const top = this.a.scrollDOM.scrollTop - documentOffset(this.a);
    const index = this.chunks.findIndex((c) => boundaryHeight(this.a, c.aTo) >= top);
    this.setCurrent(index === -1 ? undefined : index);
  }

  // --- Синхронная прокрутка ---

  private onScroll(side: Side): void {
    this.scheduleDraw();
    const src = this.view(side).scrollDOM;
    const expected = this.expectedScroll.get(side);
    if (expected !== undefined) {
      this.expectedScroll.delete(side);
      if (Math.abs(src.scrollTop - expected) < 1) return;
    }
    this.lastNavigated = undefined;
    const other: Side = side === 'a' ? 'b' : 'a';
    const dst = this.view(other).scrollDOM;
    const target = this.syncedScrollTop(side, other);
    if (Math.abs(dst.scrollTop - target) < 1) return;
    dst.scrollTop = target;
    this.expectedScroll.set(other, dst.scrollTop);
  }

  /** scrollTop ведомой колонки: строка в середине ведущей оказывается в её середине. */
  private syncedScrollTop(from: Side, to: Side): number {
    const src = this.view(from);
    const dst = this.view(to);
    const s = src.scrollDOM;
    const d = dst.scrollDOM;
    if (s.scrollTop <= 0) return 0;
    if (s.scrollTop >= s.scrollHeight - s.clientHeight - 1) return d.scrollHeight - d.clientHeight;
    const center = s.scrollTop + s.clientHeight / 2 - documentOffset(src);
    const pos = mapPosition(this.chunks, positionAtHeight(src, center), from);
    return heightAtPosition(dst, pos) + documentOffset(dst) - d.clientHeight / 2;
  }

  // --- Отрисовка: ленты и метки у полос прокрутки ---

  private scheduleDraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.drawRibbons();
      if (this.rulersDirty) {
        this.rulersDirty = false;
        this.drawRuler('a');
        this.drawRuler('b');
      }
      this.updateCurrent();
    });
  }

  private drawRibbons(): void {
    const rect = this.gap.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height));
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const topA = this.a.documentTop - rect.top;
    const topB = this.b.documentTop - rect.top;
    const paths: SVGPathElement[] = [];
    for (const c of this.chunks) {
      const aTop = topA + boundaryHeight(this.a, c.aFrom);
      const aBottom = topA + boundaryHeight(this.a, c.aTo);
      const bTop = topB + boundaryHeight(this.b, c.bFrom);
      const bBottom = topB + boundaryHeight(this.b, c.bTo);
      if (aBottom < 0 && bBottom < 0) continue;
      // Блоки отсортированы: дальше всё ниже видимой области с обеих сторон.
      if (aTop > height && bTop > height) break;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', ribbonPath(width, aTop, aBottom, bTop, bBottom));
      path.setAttribute('class', `ds-ribbon ds-${c.kind}`);
      paths.push(path);
    }
    this.svg.replaceChildren(...paths);
  }

  /** Метки блоков в полосе у прокрутки: положение — доля высоты документа. */
  private drawRuler(side: Side): void {
    const view = this.view(side);
    const total = view.contentHeight || 1;
    const marks = this.chunks.map((c, index) => {
      const [from, to] = side === 'a' ? [c.aFrom, c.aTo] : [c.bFrom, c.bTo];
      const top = boundaryHeight(view, from);
      const bottom = boundaryHeight(view, to);
      const mark = el('div', `ds-ruler__mark ds-${c.kind}`);
      mark.style.top = `${(top / total) * 100}%`;
      mark.style.height = `max(3px, ${((bottom - top) / total) * 100}%)`;
      mark.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.goTo(index);
      });
      return mark;
    });
    this.rulers[side].replaceChildren(...marks);
  }
}

function el(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

function sameSet(x: ReadonlySet<number>, y: ReadonlySet<number>): boolean {
  return x.size === y.size && [...x].every((v) => y.has(v));
}

/** Расстояние от верха прокручиваемой области до начала документа (отступ сверху). */
function documentOffset(view: EditorView): number {
  return view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
}

/** Высота от начала документа до границы перед строкой с индексом `index` (с 0). */
function boundaryHeight(view: EditorView, index: number): number {
  const doc = view.state.doc;
  if (index >= doc.lines) return view.lineBlockAt(doc.length).bottom;
  return view.lineBlockAt(doc.line(index + 1).from).top;
}

/** Дробная позиция в строках по высоте от начала документа. */
function positionAtHeight(view: EditorView, height: number): number {
  const block = view.lineBlockAtHeight(height);
  const index = view.state.doc.lineAt(block.from).number - 1;
  const fraction = block.height > 0 ? (height - block.top) / block.height : 0;
  return index + Math.min(Math.max(fraction, 0), 1);
}

/** Высота от начала документа для дробной позиции в строках. */
function heightAtPosition(view: EditorView, pos: number): number {
  const doc = view.state.doc;
  const index = Math.floor(pos);
  if (index >= doc.lines) return view.lineBlockAt(doc.length).bottom;
  const block = view.lineBlockAt(doc.line(index + 1).from);
  return block.top + (pos - index) * block.height;
}
