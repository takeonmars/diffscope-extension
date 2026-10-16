// Функция C, «Сравнить ветки»: список отличающихся файлов и ревизии сторон для диффа файла.
// - как в PR (`A...B`): левая сторона — общий предок A и B, видно только то, что сделано в B;
// - прямое (`A..B`): левая сторона — сама A, видны все отличия деревьев.
// Правая сторона может быть рабочей копией (тогда для общего предка берётся HEAD).
import type { Revision } from '../diffPanel/session';
import { WORKTREE } from '../diffPanel/session';
import { changedFiles, type CompareMode } from '../git/changes';
import type { ChangedFile } from '../git/parsers/nameStatus';
import { mergeBase } from '../git/refs';

export type RevRevision = Extract<Revision, { kind: 'rev' }>;

export interface Comparison {
  root: string;
  base: RevRevision;
  target: Revision;
  mode: CompareMode;
  /** Ревизия левой стороны: общий предок (PR) или сама база (прямое). */
  left: RevRevision;
  files: ChangedFile[];
  /** У веток нет общей истории — показано прямое сравнение. */
  noMergeBase?: boolean;
}

export async function compareBranches(
  root: string,
  base: RevRevision,
  target: Revision,
  mode: CompareMode,
  signal?: AbortSignal,
): Promise<Comparison> {
  const targetRev = target.kind === 'worktree' ? 'HEAD' : target.rev;
  let left: RevRevision = base;
  let noMergeBase = false;
  if (mode === 'pr') {
    const common = await mergeBase(root, base.rev, targetRev, signal);
    if (common) {
      left = {
        kind: 'rev',
        rev: common,
        label: base.label,
        description: `общий предок с ${revisionName(target)}: ${common.slice(0, 7)}`,
      };
    } else {
      noMergeBase = true;
    }
  }
  const files = await changedFiles(
    root,
    left.rev,
    target.kind === 'worktree' ? undefined : target.rev,
    'direct',
    signal,
  );
  return { root, base, target, mode, left, files, noMergeBase };
}

/** Ревизии сторон для диффа одного файла сравнения. */
export function fileRevisions(
  comparison: Comparison,
  file: ChangedFile,
): { left: Revision; right: Revision } {
  const left: Revision = { ...comparison.left, path: file.oldPath };
  const right: Revision =
    comparison.target.kind === 'worktree' ? WORKTREE : { ...comparison.target, path: undefined };
  return { left, right };
}

export function revisionName(revision: Revision): string {
  return revision.kind === 'worktree' ? 'рабочей копией' : revision.label;
}

/** «main...feature» / «main..feature» — как в git. */
export function comparisonTitle(c: Pick<Comparison, 'base' | 'target' | 'mode'>): string {
  const target = c.target.kind === 'worktree' ? 'рабочая копия' : c.target.label;
  return `${c.base.label}${c.mode === 'pr' ? '...' : '..'}${target}`;
}
