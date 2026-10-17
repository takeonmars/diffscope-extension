// Текущий репозиторий для команд без файла (сравнение веток, Git Log): репозиторий активного
// файла, иначе первой папки рабочей области.
import * as path from 'node:path';
import * as vscode from 'vscode';
import { findRepo } from '../git/repo';

export async function currentRepoRoot(): Promise<string | undefined> {
  const file = vscode.window.activeTextEditor?.document.uri;
  if (file?.scheme === 'file') {
    const repo = await findRepo(file.fsPath);
    if (repo) return repo.root;
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue;
    // findRepo ищет от папки файла — передаём «файл» внутри папки.
    const repo = await findRepo(path.join(folder.uri.fsPath, '.diffscope'));
    if (repo) return repo.root;
  }
  return undefined;
}
