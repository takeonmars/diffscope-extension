import * as vscode from 'vscode';
import { openDiffPanel } from './diffPanel/diffPanel';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('DiffScope', { log: true });
  context.subscriptions.push(
    log,
    vscode.commands.registerCommand('diffscope.openDiffTab', () => {
      openDiffPanel(context, log, 'DiffScope');
    }),
  );
}

export function deactivate(): void {}
