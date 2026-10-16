// История диапазона строк: `git log -L <с>,<по>:<путь>`. Из патча каждого коммита берутся путь
// файла до и после (переименования) и диапазон фрагмента в обеих версиях (заголовок @@).
import { LOG_FORMAT, parseLog, type Commit } from './parsers/log';
import { unquotePath } from './parsers/quote';
import { gitText } from './runner';

import type { LineRange } from '../../shared/protocol';

export type { LineRange };

export type LineLogEntry =
  | {
      kind: 'change';
      commit: Commit;
      /** Фрагмент до коммита; undefined — коммит создал файл. */
      before?: { path: string; range: LineRange };
      after: { path: string; range: LineRange };
    }
  /**
   * Merge-коммит без патча: так `--first-parent` показывает строки, пришедшие из влитой ветки
   * (дальше по первому родителю их нет). Диапазонов нет — дифф против первого родителя.
   */
  | { kind: 'merge'; commit: Commit };

export interface LineLogOptions {
  rev?: string;
  signal?: AbortSignal;
  /**
   * Только первый родитель (настройка; по умолчанию — нет). Без него видны коммиты влитых веток,
   * в том числе тот, где строки появились.
   */
  firstParent?: boolean;
  limit?: number;
  /** Оставить merge-коммиты без патча (по умолчанию — только с firstParent). */
  keepMerges?: boolean;
}

const RECORD = '\x1e';

export async function lineLog(
  root: string,
  path: string,
  range: LineRange,
  {
    rev = 'HEAD',
    signal,
    firstParent = false,
    limit = 500,
    keepMerges = firstParent,
  }: LineLogOptions = {},
): Promise<LineLogEntry[]> {
  const out = await gitText(
    [
      'log',
      `-L${range.from},${range.to}:${path}`,
      `-n${limit}`,
      ...(firstParent ? ['--first-parent'] : []),
      '--no-color',
      '--no-ext-diff',
      // Поля коммита через NUL, перед каждым коммитом — разделитель записей.
      `${LOG_FORMAT.replace('--format=', `--format=%x1e`)}`,
      rev,
    ],
    // -L на длинной истории бывает медленным: таймаут больше обычного, отмена — через signal.
    { cwd: root, signal, timeout: 120_000 },
  );
  return parseLineLog(out, { keepMerges });
}

/**
 * `keepMerges` — оставить merge-коммиты без патча. С --first-parent через них строки приходят
 * из влитой ветки; без него коммиты ветки видны сами, и merge нужен, только если в нём самом
 * правили эти строки (разрешение конфликта) — это проверяет вызывающий.
 */
export function parseLineLog(
  output: string,
  { keepMerges = false }: { keepMerges?: boolean } = {},
): LineLogEntry[] {
  const entries: LineLogEntry[] = [];
  for (const record of output.split(RECORD)) {
    if (!record.trim()) continue;
    const newline = record.indexOf('\n');
    const header = newline === -1 ? record : record.slice(0, newline);
    const [commit] = parseLog(`${header}\0`);
    if (!commit) continue;

    let oldPath: string | undefined;
    let newPath: string | undefined;
    let before: LineRange | undefined;
    let after: LineRange | undefined;
    for (const line of record.slice(newline + 1).split('\n')) {
      if (line.startsWith('--- ')) oldPath = diffPath(line.slice(4), 'a/');
      else if (line.startsWith('+++ ')) newPath = diffPath(line.slice(4), 'b/');
      else if (line.startsWith('@@ ')) {
        const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!hunk) continue;
        before = union(before, toRange(hunk[1], hunk[2]));
        after = union(after, toRange(hunk[3], hunk[4]));
      }
    }
    if (!newPath || !after) {
      // Коммит без патча в `log -L` — merge (с --first-parent git и в %P оставляет одного
      // родителя, так что по числу родителей его не узнать).
      if (keepMerges) entries.push({ kind: 'merge', commit });
      continue;
    }
    entries.push({
      kind: 'change',
      commit,
      before: oldPath && before ? { path: oldPath, range: before } : undefined,
      after: { path: newPath, range: after },
    });
  }
  return entries;
}

/**
 * «-12,3» → строки 12–14; без длины — одна строка. Длина 0 у `log -L` — пустое место перед
 * строкой: «-3,0» — строки вставлены между 2-й и 3-й (не после 3-й, как в обычном diff).
 */
function toRange(start: string, count: string | undefined): LineRange {
  const from = Number(start);
  const n = count === undefined ? 1 : Number(count);
  return n === 0 ? { from, to: from - 1 } : { from, to: from + n - 1 };
}

function union(a: LineRange | undefined, b: LineRange): LineRange {
  return a ? { from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) } : b;
}

/** Путь из «--- a/путь» / «+++ b/путь»; «/dev/null» — файла нет; кавычки — C-экранирование git. */
function diffPath(raw: string, prefix: string): string | undefined {
  const text = unquotePath(raw);
  if (text === '/dev/null') return undefined;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}
