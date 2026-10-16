// Панель «История» (нижняя панель VS Code): коммиты, менявшие выделенные строки. Выбор строки
// (клик или ↑/↓) показывает дифф во вкладке этой истории; новый вызов команды заменяет список
// и открывает новую вкладку.
import * as vscode from 'vscode';
import { openDiffPanel, type DiffPanelHandle } from '../diffPanel/diffPanel';
import { lineHistory, type HistoryItem, type HistoryRequest } from '../features/lineHistory';
import { GitCancelledError } from '../git/runner';
import { formatDate } from './refPicker';

export const HISTORY_VIEW = 'diffscope.history';
const LOADING_CONTEXT = 'diffscope.historyLoading';

export class HistoryView implements vscode.TreeDataProvider<HistoryItem>, vscode.Disposable {
  private readonly view: vscode.TreeView<HistoryItem>;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: HistoryItem[] = [];
  private request?: HistoryRequest;
  private panel?: DiffPanelHandle;
  private loading?: AbortController;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.view = vscode.window.createTreeView(HISTORY_VIEW, { treeDataProvider: this });
    this.disposables.push(
      this.view,
      this.changed,
      this.view.onDidChangeSelection((e) => {
        const item = e.selection[0];
        if (item) this.open(item, false);
      }),
    );
  }

  dispose(): void {
    this.loading?.abort();
    for (const d of this.disposables) d.dispose();
  }

  /** Новая история: заменяет список, первая строка открывается в новой вкладке. */
  async show(request: Omit<HistoryRequest, 'signal' | 'firstParent'>): Promise<void> {
    this.loading?.abort();
    const loading = new AbortController();
    this.loading = loading;
    this.request = { ...request };
    this.panel = undefined;
    this.items = [];
    this.changed.fire();
    const name = request.path.split('/').pop();
    const lines = request.selection;
    this.view.description = lines
      ? `${name}:${lines.from === lines.to ? lines.from : `${lines.from}–${lines.to}`}`
      : `${name} — весь файл`;
    this.view.message = lines
      ? 'Ищу коммиты, которые меняли эти строки…'
      : 'Ищу коммиты, которые меняли файл…';
    await vscode.commands.executeCommand(`${HISTORY_VIEW}.focus`);
    void vscode.commands.executeCommand('setContext', LOADING_CONTEXT, true);

    try {
      const firstParent = vscode.workspace
        .getConfiguration('diffscope')
        .get<boolean>('history.firstParent', false);
      const items = await vscode.window.withProgress({ location: { viewId: HISTORY_VIEW } }, () =>
        lineHistory({ ...request, firstParent, signal: loading.signal }),
      );
      if (loading.signal.aborted) return;
      this.items = items;
      this.view.message = items.length
        ? undefined
        : request.selection
          ? 'Эти строки ещё не попадали ни в один коммит.'
          : 'Файл ещё не попадал ни в один коммит.';
      this.changed.fire();
      if (items.length) await this.view.reveal(items[0], { select: true, focus: true });
    } catch (error) {
      if (loading.signal.aborted || error instanceof GitCancelledError) {
        this.view.message = 'Поиск остановлен.';
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`История по строкам: ${message}`);
      this.view.message = `Ошибка: ${message}`;
    } finally {
      if (this.loading === loading) {
        this.loading = undefined;
        void vscode.commands.executeCommand('setContext', LOADING_CONTEXT, false);
      }
    }
  }

  stop(): void {
    this.loading?.abort();
  }

  /** Дифф строки истории: во вкладке этой истории или, по запросу, в новой. */
  open(item: HistoryItem, newTab: boolean): void {
    const request = this.request;
    if (!request) return;
    const target = {
      root: request.root,
      path: request.path,
      left: item.left,
      right: item.right,
      fragment: item.fragment,
    };
    if (!newTab && this.panel && !this.panel.disposed) {
      this.panel.show(target);
      return;
    }
    // Фокус остаётся в списке — по нему можно ходить стрелками.
    const panel = openDiffPanel(this.context, this.log, target, { preserveFocus: true });
    if (!newTab) this.panel = panel;
  }

  getChildren(element?: HistoryItem): HistoryItem[] {
    return element ? [] : this.items;
  }

  getParent(): undefined {
    return undefined;
  }

  getTreeItem(item: HistoryItem): vscode.TreeItem {
    if (item.kind === 'uncommitted') {
      const tree = new vscode.TreeItem('Незакоммиченные изменения');
      tree.id = 'uncommitted';
      tree.description = 'HEAD ↔ рабочая копия';
      tree.iconPath = new vscode.ThemeIcon('edit');
      return tree;
    }
    const { commit } = item;
    // Сначала дата и автор, затем сообщение коммита (приглушённо) и короткий хеш.
    const tree = new vscode.TreeItem(`${formatDate(commit.date)} · ${commit.author}`);
    tree.id = commit.hash;
    tree.description = `${commit.subject} · ${commit.shortHash}`;
    tree.iconPath = new vscode.ThemeIcon('git-commit');
    tree.contextValue = 'commit';
    const path = item.right.kind === 'rev' ? item.right.path : undefined;
    tree.tooltip = new vscode.MarkdownString(
      [
        `**${escape(commit.subject)}**`,
        '',
        `${commit.hash}`,
        '',
        `${escape(commit.author)} <${escape(commit.email)}> · ${formatDate(commit.date)}`,
        path && path !== this.request?.path ? `\n\nФайл тогда назывался \`${path}\`` : '',
      ].join('\n'),
    );
    return tree;
  }
}

function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&');
}
