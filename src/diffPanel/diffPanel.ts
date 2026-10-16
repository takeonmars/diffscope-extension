// Вкладка диффа: создание webview, CSP, пути к ресурсам, связь с MessageRouter и DiffSession.
// Каждый вызов openDiffPanel() открывает новую вкладку.
import * as vscode from 'vscode';
import type { ExtensionToWebview, WebviewToExtension } from '../../shared/protocol';
import { pickRevision } from '../views/refPicker';
import { buildHtml } from './html';
import { MessageRouter } from './messageRouter';
import { DiffSession, type Revision } from './session';
import { loadSide } from './sideContent';

const VIEW_TYPE = 'diffscope.diff';

export interface DiffTarget {
  root: string;
  /** Путь файла в репозитории. */
  path: string;
  /** Файл рабочей копии. */
  uri: vscode.Uri;
  left: Revision;
  right: Revision;
}

export function openDiffPanel(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  target: DiffTarget,
): void {
  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, '', vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [webviewRoot],
  });
  const { webview } = panel;

  const session = new DiffSession(target.path, target.left, target.right, {
    loadSide: (revision, signal) =>
      loadSide(target.root, target.path, target.uri, revision, signal),
    pickRevision: (side, current) =>
      pickRevision(
        target.root,
        `${side === 'left' ? 'Левая' : 'Правая'} сторона: ${target.path}`,
        current,
      ),
    onChange: (s) => (panel.title = s.title),
  });
  panel.title = session.title;

  const post = (message: ExtensionToWebview) => void webview.postMessage(message);
  const router = new MessageRouter(session.handlers(), post, () => {
    post({ kind: 'event', event: { type: 'init', title: target.path } });
  });

  webview.html = buildHtml({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'webview.js')).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'webview.css')).toString(),
    title: session.title,
  });

  const subscription = webview.onDidReceiveMessage((message: WebviewToExtension) => {
    log.trace('webview →', message.kind, message.kind === 'request' ? message.type : '');
    router.handle(message);
  });

  panel.onDidDispose(() => {
    router.dispose();
    subscription.dispose();
  });
}
