// Вкладка диффа: создание webview, CSP, пути к ресурсам, связь с MessageRouter.
// Каждый вызов open() открывает новую вкладку.
import * as vscode from 'vscode';
import type { ExtensionToWebview, WebviewToExtension } from '../../shared/protocol';
import { createHandlers } from './handlers';
import { buildHtml } from './html';
import { MessageRouter } from './messageRouter';

const VIEW_TYPE = 'diffscope.diff';

export function openDiffPanel(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  title: string,
): void {
  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, title, vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [webviewRoot],
  });
  const { webview } = panel;

  const post = (message: ExtensionToWebview) => void webview.postMessage(message);
  const router = new MessageRouter(createHandlers(), post, () => {
    post({ kind: 'event', event: { type: 'init', title } });
  });

  webview.html = buildHtml({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'webview.js')).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'webview.css')).toString(),
    title,
  });

  const subscription = webview.onDidReceiveMessage((message: WebviewToExtension) => {
    log.trace('webview →', message);
    router.handle(message);
  });

  panel.onDidDispose(() => {
    router.dispose();
    subscription.dispose();
  });
}
