// «Показать историю»: есть выделение в редакторе — история этих строк; нет — история всего файла.
// Из проводника или вкладки (передан файл) — история этого файла.
import * as vscode from 'vscode';
import type { LineRange } from '../../shared/protocol';
import { fileAtRevision } from '../git/content';
import { findRepo, repoPath } from '../git/repo';
import type { HistoryView } from '../views/historyView';

export async function showLineHistory(
  history: HistoryView,
  log: vscode.LogOutputChannel,
  uri?: vscode.Uri,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const fromEditor =
    !(uri instanceof vscode.Uri) || uri.toString() === editor?.document.uri.toString();
  const target = uri instanceof vscode.Uri ? uri : editor?.document.uri;
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
    const path = await repoPath(repo.root, target.fsPath);
    const head = await fileAtRevision(repo.root, 'HEAD', path);
    await history.show({
      root: repo.root,
      path,
      headText: head.kind === 'text' ? head.text : undefined,
      currentText: await currentText(target),
      selection: fromEditor && editor ? selectedLines(editor.selection) : undefined,
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

/**
 * Строки выделения с 1; undefined — выделения нет (только курсор). Конец в начале строки
 * (выделены целые строки) её не включает.
 */
export function selectedLines(selection: vscode.Selection): LineRange | undefined {
  if (selection.isEmpty) return undefined;
  const from = selection.start.line + 1;
  let to = selection.end.line + 1;
  if (selection.end.character === 0 && selection.end.line > selection.start.line) to -= 1;
  return { from, to };
}
