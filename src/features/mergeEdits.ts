// Правки, сделанные прямо в merge-коммите (обычно при разрешении конфликта): строки версии
// файла в merge, которых нет ни в одном из родителей. Обычный merge таких строк не содержит —
// каждая строка пришла из какой-то ветки, и её автор виден в истории сам.
import type { LineRange } from '../../shared/protocol';
import { prepareDiff } from '../../shared/diffModel';
import { fileAtRevision } from '../git/content';
import { gitText } from '../git/runner';

/** Строки (с 0) текста `merge`, изменённые относительно каждого из `parents`. */
export function ownLines(merge: string, parents: readonly string[]): Set<number> {
  let own: Set<number> | undefined;
  for (const parent of parents) {
    const changed = new Set<number>();
    for (const c of prepareDiff(parent, merge).chunks) {
      for (let line = c.bFrom; line < c.bTo; line++) changed.add(line);
    }
    own = own ? new Set([...own].filter((line) => changed.has(line))) : changed;
    if (!own.size) break;
  }
  return own ?? new Set();
}

/** Настоящие родители коммита: в `log -L` и `log -- путь` они бывают переписаны. */
export async function commitParents(
  root: string,
  hash: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const out = await gitText(['rev-list', '--parents', '-n1', hash], { cwd: root, signal });
  return out.trim().split(' ').slice(1);
}

export interface MergeTexts {
  merge: string;
  parents: string[];
}

/** Текст файла в merge и в каждом родителе; undefined — где-то файла нет или он не текстовый. */
export async function mergeTexts(
  root: string,
  hash: string,
  path: string,
  signal?: AbortSignal,
): Promise<MergeTexts | undefined> {
  const parents = await commitParents(root, hash, signal);
  if (parents.length < 2) return undefined;
  const contents = await Promise.all(
    [hash, ...parents].map((rev) => fileAtRevision(root, rev, path, { signal })),
  );
  if (contents.some((c) => c.kind !== 'text')) return undefined;
  const [merge, ...rest] = contents.map((c) => (c.kind === 'text' ? c.text : ''));
  return { merge, parents: rest };
}

/** Есть ли среди строк `range` (с 1; без него — весь файл) написанные в самом merge. */
export function hasOwnEdits(texts: MergeTexts, range?: LineRange): boolean {
  const own = ownLines(texts.merge, texts.parents);
  if (!range) return own.size > 0;
  for (let line = range.from - 1; line < range.to; line++) if (own.has(line)) return true;
  return false;
}
