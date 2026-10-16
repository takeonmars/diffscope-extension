import * as vscode from 'vscode';
import { openDiffPanel } from './diffPanel/diffPanel';
import { setGitPath, setGitTrace } from './git/runner';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel('DiffScope', { log: true });
  context.subscriptions.push(
    log,
    vscode.commands.registerCommand('diffscope.openDiffTab', () => {
      openDiffPanel(context, log, 'DiffScope');
    }),
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
