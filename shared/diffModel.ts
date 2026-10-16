// Модель диффа в строках (общая для вкладки и расширения): блоки изменений, свёрнутые участки,
// соответствие позиций между колонками, форма ленты. Не зависит от DOM — тестируется отдельно.
import { Change, diff, presentableDiff } from '@codemirror/merge';
import { Text } from '@codemirror/state';

export type ChunkKind = 'inserted' | 'deleted' | 'modified';

/** Изменение внутри строк: позиции символов в документах A и B. */
export interface InlineChange {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

/**
 * Блок изменений в индексах строк (с 0), `to` не включается.
 * Пустой диапазон (`from === to`) — граница перед строкой `from` (или после последней строки).
 */
export interface LineChunk {
  aFrom: number;
  aTo: number;
  bFrom: number;
  bTo: number;
  kind: ChunkKind;
  /** Изменения внутри строк — только у изменённых блоков. */
  inline: InlineChange[];
}

/** Изменённые блоки больше этого размера (в символах) не размечаются внутри строк. */
const INLINE_LIMIT = 20_000;

/**
 * Дифф как в git и WebStorm: сначала по строкам, затем по символам внутри изменённых блоков.
 * Строки кодируются символами (одинаковые строки — один символ), и `diff` сравнивает эти строки
 * символов — так соседние изменения не склеиваются через совпадающие строки.
 */
export function buildLineChunks(a: Text, b: Text): LineChunk[] {
  const codes = new Map<string, string>();
  const encode = (doc: Text) => {
    let out = '';
    for (let i = 1; i <= doc.lines; i++) {
      const text = doc.line(i).text;
      let code = codes.get(text);
      if (code === undefined) codes.set(text, (code = codeUnit(codes.size)));
      out += code;
    }
    return out;
  };
  const changes = diff(encode(a), encode(b));

  const chunks: LineChunk[] = [];
  for (const c of changes) {
    const prev = chunks.at(-1);
    // Изменения вплотную друг к другу — один блок.
    if (prev && prev.aTo === c.fromA && prev.bTo === c.fromB) {
      prev.aTo = c.toA;
      prev.bTo = c.toB;
      continue;
    }
    chunks.push({
      aFrom: c.fromA,
      aTo: c.toA,
      bFrom: c.fromB,
      bTo: c.toB,
      kind: 'modified',
      inline: [],
    });
  }
  for (const chunk of chunks) {
    chunk.kind =
      chunk.aFrom === chunk.aTo ? 'inserted' : chunk.bFrom === chunk.bTo ? 'deleted' : 'modified';
    if (chunk.kind === 'modified') chunk.inline = inlineChanges(a, b, chunk);
  }
  return chunks;
}

/** Документы обеих сторон и блоки — считаются один раз на дифф и общие для всех режимов. */
export interface PreparedDiff {
  docA: Text;
  docB: Text;
  chunks: LineChunk[];
  /** Время расчёта блоков, мс. */
  diffTime: number;
}

export function prepareDiff(a: string, b: string): PreparedDiff {
  const docA = Text.of(a.split(/\r\n|\r|\n/));
  const docB = Text.of(b.split(/\r\n|\r|\n/));
  const started = performance.now();
  const chunks = buildLineChunks(docA, docB);
  return { docA, docB, chunks, diffTime: performance.now() - started };
}

/** Сводка как на GitHub: изменённая строка считается удалённой и добавленной. */
export function diffStats(chunks: readonly LineChunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const c of chunks) {
    added += c.bTo - c.bFrom;
    removed += c.aTo - c.aFrom;
  }
  return { added, removed };
}

/**
 * Квадратики сводки (всего `total`): доля добавленных и удалённых; при малом числе изменений
 * часть квадратиков серые — как на GitHub.
 */
export function statsBlocks(
  added: number,
  removed: number,
  total = 5,
): { added: number; removed: number; neutral: number } {
  const changed = added + removed;
  if (!changed) return { added: 0, removed: 0, neutral: total };
  const filled = Math.min(total, changed);
  let green = Math.round((filled * added) / changed);
  // Ненулевая сторона получает хотя бы один квадратик.
  if (added && !green) green = 1;
  if (removed && green === filled) green = filled - 1;
  return { added: green, removed: filled - green, neutral: total - filled };
}

/** Символ для n-й различной строки, в обход суррогатных пар UTF-16. */
function codeUnit(n: number): string {
  return String.fromCharCode(n < 0xd800 ? n : n + 0x800);
}

function inlineChanges(a: Text, b: Text, chunk: LineChunk): InlineChange[] {
  const startA = a.line(chunk.aFrom + 1).from;
  const endA = a.line(chunk.aTo).to;
  const startB = b.line(chunk.bFrom + 1).from;
  const endB = b.line(chunk.bTo).to;
  if (endA - startA + endB - startB > INLINE_LIMIT) return [];
  return presentableDiff(a.sliceString(startA, endA), b.sliceString(startB, endB)).map((c) => ({
    fromA: startA + c.fromA,
    toA: startA + c.toA,
    fromB: startB + c.fromB,
    toB: startB + c.toB,
  }));
}

/**
 * Наш дифф по строкам в виде изменений символов — для `diffConfig.override` CodeMirror
 * (одна колонка, `unifiedMergeView`): блоки получаются те же, что в двух колонках.
 */
export function lineDiffOverride(a: string, b: string): readonly Change[] {
  const docA = Text.of(a.split('\n'));
  const docB = Text.of(b.split('\n'));
  return toCharChanges(docA, docB, buildLineChunks(docA, docB));
}

export function toCharChanges(a: Text, b: Text, chunks: readonly LineChunk[]): Change[] {
  const out: Change[] = [];
  for (const c of chunks) {
    if (c.kind === 'modified' && c.inline.length) {
      for (const i of c.inline) out.push(new Change(i.fromA, i.toA, i.fromB, i.toB));
      continue;
    }
    const [fromA, toA] = charSpan(a, c.aFrom, c.aTo);
    const [fromB, toB] = charSpan(b, c.bFrom, c.bTo);
    out.push(new Change(fromA, toA, fromB, toB));
  }
  return out;
}

/**
 * Символы строк [from, to) вместе с переводом строки — так, чтобы удаление диапазона давало
 * документ другой стороны. В конце документа берётся перевод строки перед диапазоном.
 */
function charSpan(doc: Text, from: number, to: number): [number, number] {
  if (from === to) {
    const pos = from < doc.lines ? doc.line(from + 1).from : doc.length;
    return [pos, pos];
  }
  if (to < doc.lines) return [doc.line(from + 1).from, doc.line(to + 1).from];
  return [from > 0 ? doc.line(from).to : 0, doc.length];
}

/** Свёрнутый неизменённый участок: одинаковые строки с обеих сторон. */
export interface CollapsedRegion {
  id: number;
  aFrom: number;
  aTo: number;
  bFrom: number;
  bTo: number;
}

/**
 * Неизменённые участки, которые сворачиваются: всё, кроме `context` строк вокруг каждого блока.
 * Участки короче `minHidden` строк не сворачиваются — разделитель занял бы почти столько же места.
 */
export function collapsedRegions(
  chunks: readonly LineChunk[],
  linesA: number,
  context: number,
  minHidden = 3,
): CollapsedRegion[] {
  const regions: CollapsedRegion[] = [];
  let aPos = 0;
  let bPos = 0;
  const add = (aFrom: number, aTo: number, offset: number) => {
    if (aTo - aFrom >= minHidden) {
      regions.push({ id: regions.length, aFrom, aTo, bFrom: aFrom + offset, bTo: aTo + offset });
    }
  };
  for (const c of chunks) {
    add(aPos === 0 ? 0 : aPos + context, c.aFrom - context, bPos - aPos);
    aPos = c.aTo;
    bPos = c.bTo;
  }
  add(chunks.length ? aPos + context : 0, linesA, bPos - aPos);
  return regions;
}

/** Пустое место, которое добавляется в колонку перед строкой (индекс с 0; = число строк — в конце). */
export interface AlignmentPads {
  a: Map<number, number>;
  b: Map<number, number>;
}

/**
 * Выравнивание колонок при общей прокрутке (вкладка «все файлы»): внутри изменений колонки идут
 * независимо (ленты), а на ближайшем неизменённом участке — там, где разделитель «⋯ скрыто»
 * (или начинался бы, если раскрыт весь файл), — и в конце файла более короткая колонка
 * добирается пустыми строками. Расхождение не копится по файлу.
 */
export function alignmentPads(
  chunks: readonly LineChunk[],
  regions: readonly CollapsedRegion[],
  linesA: number,
  linesB: number,
): AlignmentPads {
  const pads: AlignmentPads = { a: new Map(), b: new Map() };
  const pad = (aLine: number, bLine: number, delta: number) => {
    if (delta > 0) pads.a.set(aLine, (pads.a.get(aLine) ?? 0) + delta);
    else if (delta < 0) pads.b.set(bLine, (pads.b.get(bLine) ?? 0) - delta);
  };
  let delta = 0;
  let r = 0;
  for (const c of chunks) {
    for (; r < regions.length && regions[r].aFrom < c.aFrom; r++) {
      pad(regions[r].aFrom, regions[r].bFrom, delta);
      delta = 0;
    }
    delta += c.bTo - c.bFrom - (c.aTo - c.aFrom);
  }
  for (; r < regions.length; r++) {
    pad(regions[r].aFrom, regions[r].bFrom, delta);
    delta = 0;
  }
  pad(linesA, linesB, delta);
  return pads;
}

export type Side = 'a' | 'b';

/**
 * Переводит позицию в строках (дробную: 12.5 — середина 13-й строки) из одной колонки в другую.
 * Вне блоков — сдвигом, внутри блока — пропорционально его размеру с обеих сторон.
 */
export function mapPosition(chunks: readonly LineChunk[], pos: number, from: Side): number {
  let srcEnd = 0;
  let dstEnd = 0;
  for (const c of chunks) {
    const [sFrom, sTo, dFrom, dTo] =
      from === 'a' ? [c.aFrom, c.aTo, c.bFrom, c.bTo] : [c.bFrom, c.bTo, c.aFrom, c.aTo];
    if (pos < sFrom) break;
    if (pos < sTo) return dFrom + ((pos - sFrom) * (dTo - dFrom)) / (sTo - sFrom);
    srcEnd = sTo;
    dstEnd = dTo;
  }
  return dstEnd + (pos - srcEnd);
}

/**
 * Следующий (`dir = 1`) или предыдущий (`-1`) блок для навигации.
 * `tops` — верх каждого блока в пикселях документа, `ref` — линия чтения (обычно треть экрана),
 * `last` — блок, к которому перешли в прошлый раз: в конце файла прокрутка не доводит блок до
 * линии чтения, и без него навигация застряла бы на одном блоке.
 */
export function nextChunkIndex(
  tops: readonly number[],
  ref: number,
  dir: 1 | -1,
  last?: number,
): number | undefined {
  const EPS = 2;
  let found = -1;
  if (dir === 1) {
    found = tops.findIndex((top) => top > ref + EPS);
  } else {
    for (let i = tops.length - 1; i >= 0 && found === -1; i--) if (tops[i] < ref - EPS) found = i;
  }
  if (last !== undefined) {
    if (dir === 1 && (found === -1 || found <= last)) found = last + 1;
    if (dir === -1 && (found === -1 || found >= last)) found = last - 1;
  }
  return found >= 0 && found < tops.length ? found : undefined;
}

/**
 * Куда перейти по F7 / Shift+F7: на соседний блок от того, что на счётчике (`last` — выбранный
 * навигацией, иначе `current` — первый видимый). Если текущий блок ещё ниже линии чтения, F7
 * сначала ставит на неё его самого. Без текущего — по положению (`nextChunkIndex`).
 */
export function navigationTarget(
  tops: readonly number[],
  ref: number,
  dir: 1 | -1,
  last: number | undefined,
  current: number | undefined,
): number | undefined {
  const base = last ?? current;
  if (base === undefined) return nextChunkIndex(tops, ref, dir);
  if (last === undefined && dir === 1 && tops[base] > ref + 2) return base;
  const index = base + dir;
  return index >= 0 && index < tops.length ? index : undefined;
}

/**
 * SVG-путь ленты между колонками шириной `width`: левый край — от aTop до aBottom,
 * правый — от bTop до bBottom, верх и низ — S-образные кривые Безье.
 */
export function ribbonPath(
  width: number,
  aTop: number,
  aBottom: number,
  bTop: number,
  bBottom: number,
): string {
  const mid = width / 2;
  const r = (n: number) => Math.round(n * 10) / 10;
  return [
    `M0,${r(aTop)}`,
    `C${r(mid)},${r(aTop)} ${r(mid)},${r(bTop)} ${r(width)},${r(bTop)}`,
    `L${r(width)},${r(bBottom)}`,
    `C${r(mid)},${r(bBottom)} ${r(mid)},${r(aBottom)} 0,${r(aBottom)}`,
    'Z',
  ].join(' ');
}
