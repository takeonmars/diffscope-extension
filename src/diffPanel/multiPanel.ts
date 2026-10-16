// Вкладка «все файлы» сравнения веток: сплошная прокрутка, над каждым файлом — заголовок,
// содержимое файлов загружается по мере прокрутки. Дерево в панели прокручивает к файлу.
import * as vscode from 'vscode';
import type { DiffSide, MultiData } from '../../shared/protocol';
import { comparisonTitle, fileRevisions, type Comparison } from '../features/branchCompare';
import { loadSide } from './sideContent';
import { createWebviewTab } from './webviewTab';

export interface MultiPanelHandle {
  /** Новое содержимое сравнения (сменились ветки, режим). */
  update(comparison: Comparison): void;
  /** Прокрутить к файлу. */
  reveal(index: number): void;
  readonly disposed: boolean;
}

export function openMultiPanel(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  initial: Comparison,
  openFile: (index: number) => void,
): MultiPanelHandle {
  let comparison = initial;
  /** Клик в дереве, пока вкладка ещё грузится: прокрутить, когда будет готова. */
  let pendingReveal: number | undefined;

  const side = async (index: number, which: 'left' | 'right', signal: AbortSignal) => {
    const file = comparison.files[index];
    const revisions = fileRevisions(comparison, file);
    const uri = vscode.Uri.joinPath(vscode.Uri.file(comparison.root), file.path);
    return loadSide(comparison.root, file.path, uri, revisions[which], signal);
  };

  const tab = createWebviewTab(context, log, {
    title: title(comparison),
    view: 'multi',
    handlers: {
      multiList: async () => listData(comparison),
      multiFile: async ({ index }, signal) => {
        if (!comparison.files[index]) throw new Error('Файл не найден — обновите сравнение.');
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
      comparison = next;
      tab.panel.title = title(next);
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

function title(c: Comparison): string {
  return `Изменения: ${comparisonTitle(c)}`;
}

function listData(c: Comparison): MultiData {
  return {
    title: comparisonTitle(c),
    left: { label: c.left.label, description: c.left.description },
    right:
      c.target.kind === 'worktree'
        ? { label: 'Рабочая копия', description: 'текущее состояние файлов' }
        : { label: c.target.label, description: c.target.description },
    files: c.files.map((f) => ({
      path: f.path,
      oldPath: f.oldPath,
      status: f.status,
      added: f.added,
      removed: f.removed,
      binary: f.binary,
    })),
    noMergeBase: c.noMergeBase,
  };
}
