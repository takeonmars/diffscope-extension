// Вкладка «все файлы»: сплошная прокрутка, над каждым файлом — заголовок, содержимое файлов
// загружается по мере прокрутки. Источник — любой набор файлов с двумя ревизиями: сравнение
// веток (дерево в панели прокручивает к файлу) или коммит и его родитель.
import * as vscode from 'vscode';
import type { DiffSide, MultiData } from '../../shared/protocol';
import type { ChangedFile } from '../git/parsers/nameStatus';
import type { Revision } from './session';
import { loadSide } from './sideContent';
import { createWebviewTab } from './webviewTab';

/** Набор файлов для вкладки «все файлы». */
export interface FileSet {
  root: string;
  /** Заголовок вкладки. */
  tabTitle: string;
  /** Заголовок над файлами: «main...feature», «Коммит a1b2c3d». */
  title: string;
  left: { label: string; description?: string };
  right: { label: string; description?: string };
  files: ChangedFile[];
  /** Ревизии сторон для диффа одного файла. */
  revisions(file: ChangedFile): { left: Revision; right: Revision };
  /** Пометка над файлами (например, «у веток нет общей истории»). */
  note?: string;
}

export interface MultiPanelHandle {
  /** Новое содержимое (сменились ветки, режим). */
  update(set: FileSet): void;
  /** Прокрутить к файлу. */
  reveal(index: number): void;
  readonly disposed: boolean;
}

export function openMultiPanel(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  initial: FileSet,
  openFile: (index: number) => void,
): MultiPanelHandle {
  let set = initial;
  /** Клик в дереве, пока вкладка ещё грузится: прокрутить, когда будет готова. */
  let pendingReveal: number | undefined;

  const side = async (index: number, which: 'left' | 'right', signal: AbortSignal) => {
    const file = set.files[index];
    const revisions = set.revisions(file);
    const uri = vscode.Uri.joinPath(vscode.Uri.file(set.root), file.path);
    return loadSide(set.root, file.path, uri, revisions[which], signal);
  };

  const tab = createWebviewTab(context, log, {
    title: set.tabTitle,
    view: 'multi',
    handlers: {
      multiList: async () => listData(set),
      multiFile: async ({ index }, signal) => {
        if (!set.files[index]) throw new Error('Файл не найден — обновите вкладку.');
        const [left, right]: DiffSide[] = await Promise.all([
          side(index, 'left', signal),
          side(index, 'right', signal),
        ]);
        return { left, right };
      },
      openFile: async ({ index }) => {
        openFile(index);
        return null;
      },
    },
    onReady: () => {
      if (pendingReveal !== undefined) tab.post({ type: 'reveal', index: pendingReveal });
      pendingReveal = undefined;
    },
  });

  return {
    update(next) {
      set = next;
      tab.panel.title = next.tabTitle;
      tab.post({ type: 'reload' });
    },
    reveal(index) {
      if (!tab.panel.visible) tab.panel.reveal(undefined, true);
      if (tab.ready) tab.post({ type: 'reveal', index });
      else pendingReveal = index;
    },
    get disposed() {
      return tab.disposed;
    },
  };
}

function listData(set: FileSet): MultiData {
  return {
    title: set.title,
    left: set.left,
    right: set.right,
    files: set.files.map((f) => ({
      path: f.path,
      oldPath: f.oldPath,
      status: f.status,
      added: f.added,
      removed: f.removed,
      binary: f.binary,
    })),
    note: set.note,
  };
}
