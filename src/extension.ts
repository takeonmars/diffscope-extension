import * as vscode from 'vscode';
import { compareWith } from './commands/compareWith';
import { showLineHistory } from './commands/showLineHistory';
import type { HistoryItem } from './features/lineHistory';
import { setGitPath, setGitTrace } from './git/runner';
import { HistoryView } from './views/historyView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('DiffScope', { log: true });
  const history = new HistoryView(context, log);
  context.subscriptions.push(
    log,
    history,
    vscode.commands.registerCommand('diffscope.showLineHistory', (uri?: vscode.Uri) =>
      showLineHistory(history, log, uri),
    ),
    vscode.commands.registerCommand('diffscope.history.stop', () => history.stop()),
    vscode.commands.registerCommand('diffscope.history.openInNewTab', (item: HistoryItem) =>
      history.open(item, true),
    ),
    vscode.commands.registerCommand('diffscope.compareWith', (uri?: vscode.Uri) =>
      compareWith(context, log, uri),
    ),
  );

  setGitTrace((e) => {
    const line = `git ${e.args.join(' ')} — ${e.ms} мс`;
    if (e.error) log.warn(`${line}: ${e.error}`);
    else log.trace(line);
  });
  const path = await gitPathFromVsCode();
  if (path) setGitPath(path);
  log.info(`git: ${path ?? 'git из PATH'}`);
}

export function deactivate(): void {
  setGitTrace(undefined);
}

interface GitExtension {
  getAPI(version: 1): { git: { path: string } };
}

/** Тот же git, что у встроенного git-расширения VS Code (настройка git.path или найденный). */
async function gitPathFromVsCode(): Promise<string | undefined> {
  try {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) return undefined;
    const exports = extension.isActive ? extension.exports : await extension.activate();
    return exports.getAPI(1).git.path;
  } catch {
    // git-расширение выключено — берём git из PATH.
    return undefined;
  }
}
