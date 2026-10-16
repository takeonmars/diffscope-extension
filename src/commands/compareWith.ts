// «Сравнить с…»: файл из проводника, вкладки редактора или активного редактора → новая вкладка
// диффа. Пока слева HEAD, справа рабочая копия; правило по умолчанию из плана (B.3) — этап 4.
import * as vscode from 'vscode';
import { openDiffPanel } from '../diffPanel/diffPanel';
import { WORKTREE } from '../diffPanel/session';
import { findRepo, repoPath } from '../git/repo';

export async function compareWith(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  uri?: vscode.Uri,
): Promise<void> {
  const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
  if (!target || target.scheme !== 'file') {
    void vscode.window.showWarningMessage('DiffScope: откройте или выберите файл на диске.');
    return;
  }
  try {
    const repo = await findRepo(target.fsPath);
    if (!repo) {
      void vscode.window.showWarningMessage('DiffScope: файл не в git-репозитории.');
      return;
    }
    openDiffPanel(context, log, {
      root: repo.root,
      path: await repoPath(repo.root, target.fsPath),
      uri: target,
      left: { kind: 'rev', rev: 'HEAD', label: 'HEAD' },
      right: WORKTREE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Сравнить с…: ${message}`);
    void vscode.window.showErrorMessage(`DiffScope: ${message}`);
  }
}
