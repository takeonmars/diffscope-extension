// Общее для webview DiffScope — вкладок (один файл, «все файлы») и окна Git Log в нижней
// панели: HTML с CSP, мост сообщений, раскладка (ширина колонок), общая для всех.
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
/** Раскладка (ширина колонок диффа и окна Log) — общая для всех вкладок. */
const LAYOUT_KEY = 'diffscope.layout';

type View = 'single' | 'multi' | 'log';

export interface WebviewConnection {
  post(event: ExtensionEvent): void;
  /** Webview загрузилась (после этого события доходят). */
  readonly ready: boolean;
  dispose(): void;
}

/** Корень сборки webview — для localResourceRoots. */
export function webviewRoot(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
}

/** HTML, мост сообщений и раскладка для готового webview (вкладки или окна в панели). */
export function connectWebview(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  webview: vscode.Webview,
  options: {
    title: string;
    view: View;
    handlers: Partial<Handlers>;
    onReady?: () => void;
  },
): WebviewConnection {
  const root = webviewRoot(context);
  const send = (message: ExtensionToWebview) => void webview.postMessage(message);
  let ready = false;

  const router = new MessageRouter(
    {
      ...options.handlers,
      // Каждая вкладка присылает только свои поля — остальные сохраняются.
      saveLayout: async (layout) => {
        const old = context.globalState.get<Layout>(LAYOUT_KEY) ?? {};
        await context.globalState.update(LAYOUT_KEY, { ...old, ...layout });
        return null;
      },
    },
    send,
    () => {
      ready = true;
      const layout = context.globalState.get<Layout>(LAYOUT_KEY);
      send({
        kind: 'event',
        event: { type: 'init', title: options.title, layout, view: options.view },
      });
      options.onReady?.();
    },
  );

  webview.html = buildHtml({
    cspSource: webview.cspSource,
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'webview.js')).toString(),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(root, 'webview.css')).toString(),
    title: options.title,
  });

  const subscription = webview.onDidReceiveMessage((message: WebviewToExtension) => {
    log.trace('webview →', message.kind, message.kind === 'request' ? message.type : '');
    router.handle(message);
  });

  return {
    post: (event) => send({ kind: 'event', event }),
    get ready() {
      return ready;
    },
    dispose() {
      router.dispose();
      subscription.dispose();
    },
  };
}

export interface WebviewTab {
  readonly panel: vscode.WebviewPanel;
  post(event: ExtensionEvent): void;
  readonly disposed: boolean;
  readonly ready: boolean;
}

/** Вкладка редактора с webview DiffScope. */
export function createWebviewTab(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  options: {
    title: string;
    view: View;
    handlers: Partial<Handlers>;
    preserveFocus?: boolean;
    onReady?: () => void;
  },
): WebviewTab {
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    options.title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: options.preserveFocus },
    { enableScripts: true, localResourceRoots: [webviewRoot(context)] },
  );
  const connection = connectWebview(context, log, panel.webview, options);
  let disposed = false;
  panel.onDidDispose(() => {
    disposed = true;
    connection.dispose();
  });
  return {
    panel,
    post: connection.post,
    get disposed() {
      return disposed;
    },
    get ready() {
      return connection.ready;
    },
  };
}
