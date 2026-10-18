import * as vscode from 'vscode';
import { compareBranches } from './commands/compareBranches';
import { compareWith } from './commands/compareWith';
import { showCommit } from './commands/showCommit';
import { showHistory } from './commands/showLineHistory';
import type { HistoryItem } from './features/lineHistory';
import { setGitPath, setGitTrace } from './git/runner';
import type { FileNode } from './features/fileTree';
import type { ChangedFile } from './git/parsers/nameStatus';
import { ChangedFilesView } from './views/changedFilesView';
import { onDidCloseLastTab } from './diffPanel/webviewTab';
import { HistoryView } from './views/historyView';
import { leaveDiffScopePanel } from './views/panel';
import { GitLog } from './views/logView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('DiffScope', { log: true });
  const history = new HistoryView(context, log);
  const changedFiles = new ChangedFilesView(context, log);
  const gitLog = new GitLog(context, log);
  // Из контекстного меню приходит узел дерева, по клику — сам файл.
  const fileOf = (arg: ChangedFile | FileNode) =>
    'kind' in arg && arg.kind === 'file' ? arg.file : (arg as ChangedFile);
  context.subscriptions.push(
    log,
    history,
    changedFiles,
    gitLog,
    // Закрыли последнюю вкладку DiffScope, а внизу всё ещё раздел DiffScope — вернуть терминал.
    onDidCloseLastTab(() => {
      if (history.visible || changedFiles.visible) void leaveDiffScopePanel();
    }),
    vscode.commands.registerCommand('diffscope.showLog', () => gitLog.show()),
    vscode.commands.registerCommand('diffscope.compareBranches', () =>
      compareBranches(changedFiles, log),
    ),
    vscode.commands.registerCommand('diffscope.changedFiles.open', (arg: ChangedFile | FileNode) =>
      changedFiles.reveal(fileOf(arg)),
    ),
    vscode.commands.registerCommand(
      'diffscope.changedFiles.openInNewTab',
      (arg: ChangedFile | FileNode) => changedFiles.open(fileOf(arg), true),
    ),
    vscode.commands.registerCommand('diffscope.changedFiles.refresh', () => changedFiles.refresh()),
    vscode.commands.registerCommand('diffscope.changedFiles.swap', () => changedFiles.swap()),
    vscode.commands.registerCommand('diffscope.changedFiles.modePr', () =>
      changedFiles.setMode('pr'),
    ),
    vscode.commands.registerCommand('diffscope.changedFiles.modeDirect', () =>
      changedFiles.setMode('direct'),
    ),
    vscode.commands.registerCommand('diffscope.changedFiles.viewAsList', () =>
      changedFiles.setTreeMode(false),
    ),
    vscode.commands.registerCommand('diffscope.changedFiles.viewAsTree', () =>
      changedFiles.setTreeMode(true),
    ),
    vscode.commands.registerCommand('diffscope.showFileHistory', (uri?: vscode.Uri) =>
      showHistory(history, log, 'file', uri),
    ),
    vscode.commands.registerCommand('diffscope.showLineHistory', (uri?: vscode.Uri) =>
      showHistory(history, log, 'lines', uri),
    ),
    vscode.commands.registerCommand('diffscope.history.stop', () => history.stop()),
    vscode.commands.registerCommand('diffscope.history.showCommit', (item: HistoryItem) => {
      if (item?.kind === 'commit' && history.root) {
        void showCommit(context, log, history.root, item.commit.hash);
      }
    }),
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
