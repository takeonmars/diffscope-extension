// Модель диффа в строках: блоки изменений, свёрнутые участки, соответствие позиций между
// колонками, форма ленты. Не зависит от DOM — тестируется отдельно.
import { diff, presentableDiff } from '@codemirror/merge';
import type { Text } from '@codemirror/state';

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
