// Вкладка диффа: создание webview, CSP, пути к ресурсам, связь с MessageRouter и DiffSession.
// Каждый вызов openDiffPanel() открывает новую вкладку; show() у неё — другой файл или ревизии
// в той же вкладке (выбор в списке истории).
import * as vscode from 'vscode';
import type { ExtensionToWebview, Layout, WebviewToExtension } from '../../shared/protocol';
import { pickRevision } from '../views/refPicker';
import { buildHtml } from './html';
import { MessageRouter } from './messageRouter';
import { DiffSession, type Fragment, type Revision } from './session';
import { loadSide } from './sideContent';

const VIEW_TYPE = 'diffscope.diff';
/** Раскладка вкладки (ширина колонок) — общая для всех вкладок. */
const LAYOUT_KEY = 'diffscope.layout';

export interface DiffTarget {
  root: string;
  /** Путь файла в репозитории (в рабочей копии). */
  path: string;
  left: Revision;
  right: Revision;
  fragment?: Fragment;
}

export interface DiffPanelHandle {
  /** Показать другую цель в этой вкладке. */
  show(target: DiffTarget): void;
  readonly disposed: boolean;
}

export function openDiffPanel(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  target: DiffTarget,
  options: { preserveFocus?: boolean } = {},
): DiffPanelHandle {
  const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    '',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: options.preserveFocus },
    { enableScripts: true, localResourceRoots: [webviewRoot] },
  );
  const { webview } = panel;
  let root = target.root;

  const session: DiffSession = new DiffSession(
    target.path,
    target.left,
    target.right,
    {
      loadSide: (revision, signal) =>
        loadSide(
          root,
          session.path,
          vscode.Uri.joinPath(vscode.Uri.file(root), session.path),
          revision,
          signal,
        ),
      pickRevision: (side, current) =>
        pickRevision(
          root,
          `${side === 'left' ? 'Левая' : 'Правая'} сторона: ${session.path}`,
          current,
        ),
      onChange: (s) => (panel.title = s.title),
    },
    target.fragment,
  );
  panel.title = session.title;

  const post = (message: ExtensionToWebview) => void webview.postMessage(message);
  const router = new MessageRouter(
    {
      ...session.handlers(),
      saveLayout: async (layout) => {
        await context.globalState.update(LAYOUT_KEY, layout);
        return null;
      },
    },
    post,
    () => {
      const layout = context.globalState.get<Layout>(LAYOUT_KEY);
      post({ kind: 'event', event: { type: 'init', title: session.path, layout } });
    },
  );

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

  let disposed = false;
  panel.onDidDispose(() => {
    disposed = true;
    router.dispose();
    subscription.dispose();
  });

  return {
    show(next) {
      root = next.root;
      session.retarget(next.path, next.left, next.right, next.fragment);
      post({ kind: 'event', event: { type: 'reload' } });
      if (!panel.visible) panel.reveal(undefined, true);
    },
    get disposed() {
      return disposed;
    },
  };
}
