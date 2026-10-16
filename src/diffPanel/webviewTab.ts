// Общее для вкладок DiffScope (один файл и «все файлы»): webview с CSP, мост сообщений,
// раскладка (ширина колонок), общая для всех вкладок.
import * as vscode from 'vscode';
import type {
  ExtensionEvent,
  ExtensionToWebview,
  Layout,
  WebviewToExtension,
} from '../../shared/protocol';
import { buildHtml } from './html';
import { MessageRouter, type Handlers } from './messageRouter';

const VIEW_TYPE = 'diffscope.diff';
/** Раскладка вкладки (ширина колонок) — общая для всех вкладок. */
const LAYOUT_KEY = 'diffscope.layout';

export interface WebviewTab {
  readonly panel: vscode.WebviewPanel;
  post(event: ExtensionEvent): void;
  readonly disposed: boolean;
  /** Вкладка загрузилась (после этого события доходят). */
  readonly ready: boolean;
}

export function createWebviewTab(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  options: {
    title: string;
    view: 'single' | 'multi';
    handlers: Partial<Handlers>;
    preserveFocus?: boolean;
    onReady?: () => void;
  },
): WebviewTab {
  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    options.title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: options.preserveFocus },
    { enableScripts: true, localResourceRoots: [webviewRoot] },
  );
  const { webview } = panel;
  const send = (message: ExtensionToWebview) => void webview.postMessage(message);
  let ready = false;
  let disposed = false;

  const router = new MessageRouter(
    {
      ...options.handlers,
      saveLayout: async (layout) => {
        await context.globalState.update(LAYOUT_KEY, layout);
        return null;
      },
    },
    send,
    () => {
      ready = true;
      const layout = context.globalState.get<Layout>(LAYOUT_KEY);
      send({
        kind: 'event',
        event: { type: 'init', title: panel.title, layout, view: options.view },
      });
      options.onReady?.();
    },
  );

  webview.html = buildHtml({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'webview.js')).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'webview.css')).toString(),
    title: options.title,
  });

  const subscription = webview.onDidReceiveMessage((message: WebviewToExtension) => {
    log.trace('webview →', message.kind, message.kind === 'request' ? message.type : '');
    router.handle(message);
  });
  panel.onDidDispose(() => {
    disposed = true;
    router.dispose();
    subscription.dispose();
  });

  return {
    panel,
    post: (event) => send({ kind: 'event', event }),
    get disposed() {
      return disposed;
    },
    get ready() {
      return ready;
    },
  };
}
