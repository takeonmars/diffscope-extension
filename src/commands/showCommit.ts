// «Посмотреть изменения» коммита: вкладка «все файлы» коммита (новая на каждый вызов). Файл
// в отдельной вкладке — из заголовка файла; эта вкладка одна на коммит и переиспользуется.
import * as vscode from 'vscode';
import { openDiffPanel, type DiffPanelHandle } from '../diffPanel/diffPanel';
import { openMultiPanel } from '../diffPanel/multiPanel';
import { commitFileSet } from '../features/commitView';

export async function showCommit(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  root: string,
  hash: string,
): Promise<void> {
  try {
    const set = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'DiffScope: загружаю коммит…' },
      () => commitFileSet(root, hash),
    );
    let single: DiffPanelHandle | undefined;
    openMultiPanel(context, log, set, (index) => {
      const file = set.files[index];
      if (!file) return;
      const target = { root, path: file.path, ...set.revisions(file) };
      if (single && !single.disposed) single.show(target);
      else single = openDiffPanel(context, log, target);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Посмотреть изменения: ${message}`);
    void vscode.window.showErrorMessage(`DiffScope: ${message}`);
  }
}
