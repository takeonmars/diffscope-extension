// «Показать историю» — коммиты, менявшие файл; «Показать историю по строкам» — коммиты,
// менявшие выделенные строки (без выделения — строку с курсором). Файл — из проводника или
// вкладки (передан uri) или активного редактора.
import * as vscode from 'vscode';
import { selectedLines } from '../features/selection';
import { fileAtRevision } from '../git/content';
import { findRepo, repoPath } from '../git/repo';
import type { HistoryView } from '../views/historyView';

export async function showHistory(
  history: HistoryView,
  log: vscode.LogOutputChannel,
  kind: 'file' | 'lines',
  uri?: vscode.Uri,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const target = uri instanceof vscode.Uri ? uri : editor?.document.uri;
  // Строки берутся из редактора этого же файла.
  const lineEditor =
    kind === 'lines' && editor && editor.document.uri.toString() === target?.toString()
      ? editor
      : undefined;
  if (!target || target.scheme !== 'file') {
    void vscode.window.showWarningMessage('DiffScope: откройте или выберите файл на диске.');
    return;
  }
  if (kind === 'lines' && !lineEditor) {
    void vscode.window.showWarningMessage('DiffScope: выделите строки в редакторе файла.');
    return;
  }
  try {
    const repo = await findRepo(target.fsPath);
    if (!repo) {
      void vscode.window.showWarningMessage('DiffScope: файл не в git-репозитории.');
      return;
    }
    const path = await repoPath(repo.root, target.fsPath);
    const head = await fileAtRevision(repo.root, 'HEAD', path);
    await history.show({
      root: repo.root,
      path,
      headText: head.kind === 'text' ? head.text : undefined,
      currentText: await currentText(target),
      selection: lineEditor ? selectedLines(lineEditor.selection) : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`История: ${message}`);
    void vscode.window.showErrorMessage(`DiffScope: ${message}`);
  }
}

/** Текст открытого документа (с несохранёнными правками) или файла на диске. */
async function currentText(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return ''; // файл удалён — вся история в git
  }
}
