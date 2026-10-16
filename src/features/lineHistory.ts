// Функция A, «История»: выделение в редакторе → коммиты, которые меняли эти строки; без
// выделения — коммиты, которые меняли файл (с переименованиями).
// `git log -L` считает строки по HEAD, а в редакторе могут быть незакоммиченные правки, поэтому
// выделение сначала переводится в номера строк HEAD по диффу «HEAD ↔ текст редактора».
import type { LineRange } from '../../shared/protocol';
import { mapPosition, prepareDiff } from '../../shared/diffModel';
import { WORKTREE, type Revision } from '../diffPanel/session';
import { fileLog, mergesTouching, type FileLogEntry } from '../git/fileLog';
import { lineLog, type LineLogEntry } from '../git/lineLog';
import { hasOwnEdits, mergeTexts } from './mergeEdits';
import type { Commit } from '../git/parsers/log';

export interface SelectionInHead {
  /** Те же строки в HEAD; undefined — выделение целиком новое (или файла нет в HEAD). */
  head?: LineRange;
  /** Незакоммиченные правки затрагивают выделение. */
  uncommitted: boolean;
}

/**
 * Выделение (строки текста редактора `current`) → строки в `head`. Изменённые строки
 * переводятся в свой прежний вид (весь блок), добавленные — отбрасываются.
 */
export function selectionInHead(
  head: string | undefined,
  current: string,
  selection: LineRange,
): SelectionInHead {
  if (head === undefined) return { uncommitted: true };
  const { chunks } = prepareDiff(head, current);
  const from = selection.from - 1; // с 0
  const to = selection.to - 1;
  let headFrom = Infinity;
  let headTo = -Infinity;
  let uncommitted = false;
  const include = (a: number, b: number) => {
    headFrom = Math.min(headFrom, a);
    headTo = Math.max(headTo, b);
  };

  for (const c of chunks) {
    if (c.bFrom === c.bTo) {
      // Удалённые строки между выделенными.
      if (c.bFrom > from && c.bFrom <= to) {
        uncommitted = true;
        include(c.aFrom, c.aTo - 1);
      }
    } else if (c.bFrom <= to && c.bTo > from) {
      uncommitted = true;
      if (c.kind === 'modified') include(c.aFrom, c.aTo - 1);
    }
  }
  for (let line = from; line <= to; line++) {
    const inChunk = chunks.some((c) => line >= c.bFrom && line < c.bTo);
    if (!inChunk) {
      const a = mapPosition(chunks, line, 'b');
      include(a, a);
    }
  }
  return {
    head: headFrom <= headTo ? { from: headFrom + 1, to: headTo + 1 } : undefined,
    uncommitted,
  };
}

/** Строка панели «История»: незакоммиченные правки или коммит. */
export type HistoryItem =
  | { kind: 'uncommitted'; left: Revision; right: Revision; fragment?: Fragment }
  | { kind: 'commit'; commit: Commit; left: Revision; right: Revision; fragment?: Fragment };

export interface Fragment {
  left: LineRange;
  right: LineRange;
}

export interface HistoryRequest {
  root: string;
  path: string;
  /** Текст файла в HEAD; undefined — файла в HEAD нет. */
  headText: string | undefined;
  /** Текст в редакторе (с несохранёнными правками). */
  currentText: string;
  /** Выделенные строки; undefined — история всего файла. */
  selection?: LineRange;
  firstParent?: boolean;
  signal?: AbortSignal;
}

const UNCOMMITTED_SIDES = {
  left: { kind: 'rev', rev: 'HEAD', label: 'HEAD', description: 'последний коммит' },
  right: WORKTREE,
} as const satisfies { left: Revision; right: Revision };

export async function lineHistory(request: HistoryRequest): Promise<HistoryItem[]> {
  const { root, path, headText, currentText, selection, signal } = request;
  if (!selection) return fileHistory(request);
  const mapped = selectionInHead(headText, currentText, selection);
  const items: HistoryItem[] = [];
  if (mapped.uncommitted) {
    items.push({
      kind: 'uncommitted',
      ...UNCOMMITTED_SIDES,
      fragment: {
        // Целиком новое выделение — пустое место в HEAD, где оно появилось.
        left: mapped.head ?? emptyAt(headText, currentText, selection),
        right: selection,
      },
    });
  }
  if (mapped.head) {
    const entries = await lineLog(root, path, mapped.head, {
      signal,
      firstParent: request.firstParent,
      keepMerges: true,
    });
    for (const entry of entries) {
      if (entry.kind === 'change' || request.firstParent) {
        items.push(commitItem(entry, path));
        continue;
      }
      // Без --first-parent merge нужен, только если эти строки правили в нём самом.
      const own = await mergeWithOwnEdits(request, entry.commit, mapped.head);
      if (own) items.push(own);
    }
  }
  return items;
}

/**
 * Merge, в котором правили строки фрагмента (разрешение конфликта): элемент истории с диффом
 * против первого родителя и фрагментом; undefined — merge эти строки не трогал.
 */
async function mergeWithOwnEdits(
  request: HistoryRequest,
  commit: Commit,
  headRange: LineRange,
): Promise<HistoryItem | undefined> {
  const { root, path, headText, signal } = request;
  if (headText === undefined) return undefined;
  const texts = await mergeTexts(root, commit.hash, path, signal);
  if (!texts) return undefined;
  // Фрагмент в версии merge — так же, как выделение переводится в HEAD.
  const atMerge = selectionInHead(texts.merge, headText, headRange).head;
  if (!atMerge || !hasOwnEdits(texts, atMerge)) return undefined;
  const atParent = selectionInHead(texts.parents[0], texts.merge, atMerge).head;
  return {
    kind: 'commit',
    commit,
    left: firstParentRevision(commit, path),
    right: commitRevision(commit, path),
    fragment: {
      left: atParent ?? { from: atMerge.from, to: atMerge.from - 1 },
      right: atMerge,
    },
  };
}

/** Основная ветка до merge: «<хеш>^1» — настоящий первый родитель. */
function firstParentRevision(commit: Commit, path: string): Revision {
  return {
    kind: 'rev',
    rev: `${commit.hash}^1`,
    label: `${commit.shortHash}^1`,
    description: `основная ветка до ${commit.shortHash}`,
    path,
  };
}

async function fileHistory(request: HistoryRequest): Promise<HistoryItem[]> {
  const { root, path, headText, currentText, signal } = request;
  const items: HistoryItem[] = [];
  if (headText === undefined || normalize(headText) !== normalize(currentText)) {
    items.push({ kind: 'uncommitted', ...UNCOMMITTED_SIDES });
  }
  if (headText !== undefined) {
    const entries = await fileLog(root, path, { signal, firstParent: request.firstParent });
    const commits = entries.map(fileCommitItem);
    // С --first-parent -m merge и так в списке; без него — добавить merge с правками в нём самом,
    // не меняя порядок остальных: перед первым коммитом не новее него (при равном времени merge
    // новее по истории).
    if (!request.firstParent) {
      for (const merge of await mergesWithOwnEdits(root, path, signal)) {
        const at = commits.findIndex(
          (c) => c.kind === 'commit' && c.commit.date <= merge.commit.date,
        );
        commits.splice(at === -1 ? commits.length : at, 0, merge);
      }
    }
    items.push(...commits);
  }
  return items;
}

async function mergesWithOwnEdits(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<Extract<HistoryItem, { kind: 'commit' }>[]> {
  const items: Extract<HistoryItem, { kind: 'commit' }>[] = [];
  for (const commit of await mergesTouching(root, path, { signal })) {
    const texts = await mergeTexts(root, commit.hash, path, signal);
    if (!texts || !hasOwnEdits(texts)) continue;
    items.push({
      kind: 'commit',
      commit,
      left: firstParentRevision(commit, path),
      right: commitRevision(commit, path),
    });
  }
  return items;
}

/** Переводы строк не считаются правкой. */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function fileCommitItem(entry: FileLogEntry): HistoryItem {
  const { commit, pathBefore, pathAfter } = entry;
  return {
    kind: 'commit',
    commit,
    left: parentRevision(commit, pathBefore ?? pathAfter),
    right: commitRevision(commit, pathAfter),
  };
}

/** Родитель коммита; у корневого «<хеш>^» не существует — слева «нет файла». */
/**
 * Первый родитель коммита. `trustParents: false` — для `log -L`: он подставляет в %P предыдущий
 * коммит, менявший эти строки, а не настоящего родителя, поэтому берём «<хеш>^».
 */
function parentRevision(commit: Commit, path: string, trustParents = true): Revision {
  const parent = trustParents ? commit.parents[0] : undefined;
  return {
    kind: 'rev',
    rev: parent ?? `${commit.hash}^`,
    label: parent ? parent.slice(0, commit.shortHash.length) : `${commit.shortHash}^`,
    description: `до ${commit.shortHash}`,
    path,
  };
}

function commitRevision(commit: Commit, path: string): Revision {
  return {
    kind: 'rev',
    rev: commit.hash,
    label: commit.shortHash,
    description: commit.subject,
    path,
  };
}

function commitItem(entry: LineLogEntry, path: string): HistoryItem {
  const { commit } = entry;
  if (entry.kind === 'merge') {
    // Слева — настоящий первый родитель («^1»): в %P у `log -L` родитель переписан на тот, откуда
    // пришли строки, и дифф с ним был бы пустым. Путь на тот момент неизвестен — берём текущий.
    return {
      kind: 'commit',
      commit,
      left: firstParentRevision(commit, path),
      right: commitRevision(commit, path),
    };
  }
  const { before, after } = entry;
  return {
    kind: 'commit',
    commit,
    left: parentRevision(commit, before?.path ?? after.path, false),
    right: commitRevision(commit, after.path),
    fragment: {
      // Строки появились в этом коммите — слева пустое место.
      left: before?.range ?? { from: 1, to: 0 },
      right: after.range,
    },
  };
}

/** Пустой диапазон в HEAD перед местом, где в тексте редактора начинается выделение. */
function emptyAt(head: string | undefined, current: string, selection: LineRange): LineRange {
  if (head === undefined) return { from: 1, to: 0 };
  const { chunks } = prepareDiff(head, current);
  const a = Math.floor(mapPosition(chunks, selection.from - 1, 'b'));
  return { from: a + 1, to: a };
}
