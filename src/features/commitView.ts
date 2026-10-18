// Пункт D, «коммит целиком»: все файлы коммита против его первого родителя (у корневого —
// против пустого дерева) — набор для вкладки «все файлы».
import type { FileSet } from '../diffPanel/multiPanel';
import type { Revision } from '../diffPanel/session';
import { commitFiles } from '../git/changes';
import { resolveCommit } from '../git/refs';

export async function commitFileSet(
  root: string,
  hash: string,
  signal?: AbortSignal,
): Promise<FileSet> {
  const [{ base, files }, commit] = await Promise.all([
    commitFiles(root, hash, signal),
    resolveCommit(root, hash, signal),
  ]);
  const short = commit?.shortHash ?? hash.slice(0, 7);
  const subject = commit?.subject ?? '';
  const parents = commit?.parents.length ?? 1;
  const left = {
    label: `${short}^`,
    description: parents ? 'родитель' : 'пусто — корневой коммит',
  };
  const right = { label: short, description: subject };
  return {
    root,
    tabTitle: `Коммит ${short}: ${subject}`,
    title: `Коммит ${short}`,
    left,
    right,
    files,
    revisions: (file) => {
      const l: Revision = { kind: 'rev', rev: base, ...left, path: file.oldPath };
      const r: Revision = { kind: 'rev', rev: hash, ...right };
      return { left: l, right: r };
    },
    note: parents > 1 ? 'Merge-коммит: изменения относительно первого родителя.' : undefined,
  };
}
