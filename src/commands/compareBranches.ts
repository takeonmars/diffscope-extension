// «Сравнить ветки»: выбор базы (слева) и того, что сравнивается (справа), → панель «Изменённые
// файлы». По умолчанию: база — ветка по умолчанию (origin/HEAD, иначе main / master), справа —
// текущая ветка; если текущая и есть база — рабочая копия.
import * as vscode from 'vscode';
import { WORKTREE, type Revision } from '../diffPanel/session';
import type { RevRevision } from '../features/branchCompare';
import type { CompareMode } from '../git/changes';
import { defaultBranch, getHead, listRefs } from '../git/refs';
import { currentRepoRoot } from './currentRepo';
import type { ChangedFilesView } from '../views/changedFilesView';
import { pickRevision } from '../views/refPicker';

export async function compareBranches(
  view: ChangedFilesView,
  log: vscode.LogOutputChannel,
): Promise<void> {
  try {
    const root = await currentRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(
        'DiffScope: откройте папку или файл из git-репозитория.',
      );
      return;
    }
    const previous = view.current?.root === root ? view.current : undefined;
    const [refs, head] = await Promise.all([listRefs(root), getHead(root)]);
    const fallbackBase: RevRevision = { kind: 'rev', rev: 'HEAD', label: 'HEAD' };
    const def = await defaultBranch(root, refs);
    const base =
      previous?.base ??
      (def ? { kind: 'rev' as const, rev: def.fullName, label: def.name } : fallbackBase);
    const currentBranch = head.branch
      ? refs.find((r) => r.kind === 'branch' && r.name === head.branch)
      : undefined;
    const target: Revision =
      previous?.target ??
      (currentBranch && currentBranch.fullName !== base.rev
        ? { kind: 'rev', rev: currentBranch.fullName, label: currentBranch.name }
        : WORKTREE);

    const pickedBase = await pickRevision(root, 'Сравнить ветки: база (слева)', base, {
      worktree: false,
    });
    if (!pickedBase || pickedBase.kind !== 'rev') return;
    const pickedTarget = await pickRevision(
      root,
      `Сравнить с ${pickedBase.label}: справа`,
      target,
      {
        worktreeDescription: 'текущее состояние всех файлов',
      },
    );
    if (!pickedTarget) return;

    const mode =
      previous?.mode ??
      vscode.workspace
        .getConfiguration('diffscope')
        .get<CompareMode>('branchCompare.defaultMode', 'pr');
    await view.show({ root, base: pickedBase, target: pickedTarget, mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Сравнить ветки: ${message}`);
    void vscode.window.showErrorMessage(`DiffScope: ${message}`);
  }
}
