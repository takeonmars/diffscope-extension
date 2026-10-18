// Панель «Изменённые файлы» (нижняя панель): дерево отличающихся файлов сравнения веток со
// статусами, как в Source Control. Сравнение открывает вкладку «все файлы» (сплошная прокрутка),
// клик по файлу в дереве прокручивает её к файлу; «Открыть в отдельной вкладке» — в контекстном
// меню и в заголовке файла во вкладке.
import * as vscode from 'vscode';
import { openDiffPanel, type DiffPanelHandle } from '../diffPanel/diffPanel';
import { openMultiPanel, type MultiPanelHandle } from '../diffPanel/multiPanel';
import type { Revision } from '../diffPanel/session';
import {
  compareBranches,
  comparisonTitle,
  fileRevisions,
  type Comparison,
  type RevRevision,
} from '../features/branchCompare';
import { buildFileList, buildFileTree, type FileNode } from '../features/fileTree';
import type { CompareMode } from '../git/changes';
import type { ChangedFile, ChangeStatus } from '../git/parsers/nameStatus';
import { GitCancelledError } from '../git/runner';

export const CHANGED_FILES_VIEW = 'diffscope.changedFiles';
/** Схема resourceUri файлов панели: по ней — значок типа файла и буква статуса. */
const SCHEME = 'diffscope-change';

const STATUS: Record<ChangeStatus, { letter: string; color: string; title: string }> = {
  added: { letter: 'A', color: 'gitDecoration.addedResourceForeground', title: 'Добавлен' },
  modified: { letter: 'M', color: 'gitDecoration.modifiedResourceForeground', title: 'Изменён' },
  deleted: { letter: 'D', color: 'gitDecoration.deletedResourceForeground', title: 'Удалён' },
  renamed: { letter: 'R', color: 'gitDecoration.renamedResourceForeground', title: 'Переименован' },
  copied: { letter: 'C', color: 'gitDecoration.addedResourceForeground', title: 'Скопирован' },
  typeChanged: {
    letter: 'T',
    color: 'gitDecoration.modifiedResourceForeground',
    title: 'Сменился тип',
  },
  unmerged: {
    letter: 'U',
    color: 'gitDecoration.conflictingResourceForeground',
    title: 'Конфликт',
  },
  unknown: { letter: '?', color: 'gitDecoration.untrackedResourceForeground', title: 'Неизвестно' },
};

export interface ComparisonRequest {
  root: string;
  base: RevRevision;
  target: Revision;
  mode: CompareMode;
}

export class ChangedFilesView
  implements vscode.TreeDataProvider<FileNode>, vscode.FileDecorationProvider, vscode.Disposable
{
  private readonly view: vscode.TreeView<FileNode>;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private request?: ComparisonRequest;
  private comparison?: Comparison;
  private nodes: FileNode[] = [];
  private asTree = true;
  private panel?: DiffPanelHandle;
  private multi?: MultiPanelHandle;
  private loading?: AbortController;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.view = vscode.window.createTreeView(CHANGED_FILES_VIEW, {
      treeDataProvider: this,
      showCollapseAll: true,
    });
    this.disposables.push(
      this.view,
      this.changed,
      vscode.window.registerFileDecorationProvider(this),
    );
    void this.setContext();
  }

  /** Панель показана (раздел DiffScope открыт внизу). */
  get visible(): boolean {
    return this.view.visible;
  }

  dispose(): void {
    this.loading?.abort();
    for (const d of this.disposables) d.dispose();
  }

  get current(): ComparisonRequest | undefined {
    return this.request;
  }

  /** Новое сравнение: заменяет содержимое панели, файлы открываются в новой вкладке. */
  async show(request: ComparisonRequest): Promise<void> {
    this.request = request;
    // Новое сравнение — новые вкладки; смена режима и обновление — в тех же.
    this.panel = undefined;
    this.multi = undefined;
    await this.refresh();
  }

  async setMode(mode: CompareMode): Promise<void> {
    if (!this.request || this.request.mode === mode) return;
    this.request = { ...this.request, mode };
    await this.refresh();
  }

  async swap(): Promise<void> {
    const r = this.request;
    if (!r || r.target.kind === 'worktree') {
      void vscode.window.showInformationMessage(
        'DiffScope: рабочая копия может быть только справа — поменять местами нельзя.',
      );
      return;
    }
    this.request = { ...r, base: r.target, target: r.base };
    await this.refresh();
  }

  setTreeMode(asTree: boolean): void {
    this.asTree = asTree;
    this.rebuild();
    void this.setContext();
  }

  /** Пересчитать отличия (ветки могли сдвинуться). */
  async refresh(): Promise<void> {
    const request = this.request;
    if (!request) return;
    this.loading?.abort();
    const loading = new AbortController();
    this.loading = loading;
    this.comparison = undefined;
    this.nodes = [];
    this.changed.fire();
    this.view.description = comparisonTitle(request);
    this.view.message = 'Сравниваю…';
    await vscode.commands.executeCommand(`${CHANGED_FILES_VIEW}.focus`);
    void this.setContext();
    try {
      const comparison = await vscode.window.withProgress(
        { location: { viewId: CHANGED_FILES_VIEW } },
        () =>
          compareBranches(request.root, request.base, request.target, request.mode, loading.signal),
      );
      if (loading.signal.aborted) return;
      this.comparison = comparison;
      this.rebuild();
      this.showAll();
      const count = comparison.files.length;
      this.view.description = `${comparisonTitle(request)} · ${filesText(count)}`;
      this.view.message = count
        ? comparison.noMergeBase
          ? 'У веток нет общей истории — показано прямое сравнение.'
          : undefined
        : 'Различий нет.';
    } catch (error) {
      if (loading.signal.aborted || error instanceof GitCancelledError) return;
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`Сравнение веток: ${message}`);
      this.view.message = `Ошибка: ${message}`;
    } finally {
      if (this.loading === loading) this.loading = undefined;
    }
  }

  /** Вкладка «все файлы» этого сравнения: обновить или открыть заново. */
  private showAll(): MultiPanelHandle | undefined {
    const comparison = this.comparison;
    if (!comparison) return undefined;
    if (this.multi && !this.multi.disposed) {
      this.multi.update(comparison);
    } else {
      this.multi = openMultiPanel(this.context, this.log, comparison, (index) => {
        const file = this.comparison?.files[index];
        if (file) this.open(file, false);
      });
    }
    return this.multi;
  }

  /** Клик в дереве: прокрутить вкладку «все файлы» к файлу (закрыта — открыть). */
  reveal(file: ChangedFile): void {
    const index = this.comparison?.files.indexOf(file) ?? -1;
    if (index === -1) return;
    const multi = this.multi && !this.multi.disposed ? this.multi : this.showAll();
    multi?.reveal(index);
  }

  /** Дифф одного файла: в отдельной вкладке этого сравнения или, по запросу, в новой. */
  open(file: ChangedFile, newTab: boolean): void {
    const comparison = this.comparison;
    if (!comparison) return;
    const { left, right } = fileRevisions(comparison, file);
    const target = { root: comparison.root, path: file.path, left, right };
    if (!newTab && this.panel && !this.panel.disposed) {
      this.panel.show(target);
      return;
    }
    const panel = openDiffPanel(this.context, this.log, target, { preserveFocus: true });
    if (!newTab) this.panel = panel;
  }

  private rebuild(): void {
    const files = this.comparison?.files ?? [];
    this.nodes = this.asTree ? buildFileTree(files) : buildFileList(files);
    this.changed.fire();
  }

  private setContext(): Thenable<unknown> {
    return Promise.all([
      vscode.commands.executeCommand('setContext', 'diffscope.hasComparison', !!this.request),
      vscode.commands.executeCommand('setContext', 'diffscope.compareMode', this.request?.mode),
      vscode.commands.executeCommand('setContext', 'diffscope.changedFilesAsTree', this.asTree),
    ]);
  }

  // --- TreeDataProvider ---

  getChildren(node?: FileNode): FileNode[] {
    if (!node) return this.nodes;
    return node.kind === 'folder' ? node.children : [];
  }

  getTreeItem(node: FileNode): vscode.TreeItem {
    if (node.kind === 'folder') {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `folder:${node.path}`;
      item.iconPath = vscode.ThemeIcon.Folder;
      item.resourceUri = vscode.Uri.from({ scheme: SCHEME, path: `/${node.path}` });
      item.description = `${node.count}`;
      return item;
    }
    const { file } = node;
    const item = new vscode.TreeItem(node.name);
    item.id = `file:${file.path}`;
    item.iconPath = vscode.ThemeIcon.File;
    item.resourceUri = vscode.Uri.from({
      scheme: SCHEME,
      path: `/${file.path}`,
      query: file.status,
    });
    const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    item.description = [
      file.oldPath ? `← ${file.oldPath}` : undefined,
      !this.asTree && folder ? folder : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
    item.tooltip = `${STATUS[file.status].title}: ${file.path}${file.oldPath ? `\nбыл: ${file.oldPath}` : ''}`;
    item.contextValue = 'changedFile';
    item.command = { command: 'diffscope.changedFiles.open', title: 'Открыть', arguments: [file] };
    return item;
  }

  // --- FileDecorationProvider: буква и цвет статуса ---

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== SCHEME || !uri.query) return undefined;
    const status = STATUS[uri.query as ChangeStatus];
    if (!status) return undefined;
    return new vscode.FileDecoration(
      status.letter,
      status.title,
      new vscode.ThemeColor(status.color),
    );
  }
}

function filesText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'файл'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'файла'
        : 'файлов';
  return `${n} ${word}`;
}
