// «Сравнить с…»: файл из проводника, вкладки редактора или активного редактора → новая вкладка
// диффа с ревизиями по умолчанию (features/fileCompare).
import * as vscode from 'vscode';
import { openDiffPanel } from '../diffPanel/diffPanel';
import { defaultRevisions } from '../features/fileCompare';
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
    if (repo.shallow) {
      void vscode.window.showInformationMessage(
        'DiffScope: репозиторий клонирован не полностью (shallow) — история обрезана.',
      );
    }
    const path = await repoPath(repo.root, target.fsPath);
    const { left, right } = await defaultRevisions(repo.root, path);
    openDiffPanel(context, log, { root: repo.root, path, left, right });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Сравнить с…: ${message}`);
    void vscode.window.showErrorMessage(`DiffScope: ${message}`);
  }
}
