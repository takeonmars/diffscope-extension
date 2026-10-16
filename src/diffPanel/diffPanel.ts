// Вкладка диффа одного файла: DiffSession поверх общей вкладки (webviewTab). Каждый вызов
// openDiffPanel() открывает новую вкладку; show() у неё — другой файл или ревизии в той же
// вкладке (выбор в списке истории, «В отдельной вкладке» у файла сравнения).
import * as vscode from 'vscode';
import { pickRevision } from '../views/refPicker';
import { DiffSession, type Fragment, type Revision } from './session';
import { loadSide } from './sideContent';
import { createWebviewTab } from './webviewTab';

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
      onChange: (s) => (tab.panel.title = s.title),
    },
    target.fragment,
  );

  const tab = createWebviewTab(context, log, {
    title: session.title,
    view: 'single',
    handlers: session.handlers(),
    preserveFocus: options.preserveFocus,
  });

  return {
    show(next) {
      root = next.root;
      session.retarget(next.path, next.left, next.right, next.fragment);
      tab.post({ type: 'reload' });
      if (!tab.panel.visible) tab.panel.reveal(undefined, true);
    },
    get disposed() {
      return tab.disposed;
    },
  };
}
