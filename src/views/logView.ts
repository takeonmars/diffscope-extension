// Окно Git Log — вкладка редактора: коммиты с графом веток; клик по коммиту раскрывает под ним
// файлы и описание, клик по файлу — дифф во всплывающем окне поверх лога. Одна вкладка на репозиторий: повторный вызов её показывает. Репозиторий — текущий
// (активный файл или первая папка); автообновление — по изменению HEAD и ссылок в .git.
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import type { DiffSide, LogRefs, MultiFile } from '../../shared/protocol';
import { currentRepoRoot } from '../commands/currentRepo';
import { showCommit } from '../commands/showCommit';
import type { Revision } from '../diffPanel/session';
import { loadSide } from '../diffPanel/sideContent';
import { createWebviewTab, type WebviewTab } from '../diffPanel/webviewTab';
import { commitFiles, commitMessage } from '../git/changes';
import { commitLog } from '../git/commitLog';
import type { ChangedFile } from '../git/parsers/nameStatus';
import { getHead, listRefs } from '../git/refs';
import { gitText } from '../git/runner';

/** Сколько коммитов в одной порции. */
const PAGE = 500;
/** Изменения в .git сыплются пачкой (commit, fetch) — обновляем раз в эту паузу. */
const REFRESH_DELAY_MS = 500;
/** Сколько последних коммитов держать с файлами — ↑/↓ по списку не перечитывает их. */
const FILES_CACHE = 20;

interface CommitFiles {
  base: string;
  files: ChangedFile[];
}

export class GitLog implements vscode.Disposable {
  private tab?: WebviewTab;
  private root?: string;
  private watcher?: vscode.Disposable;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly files = new Map<string, Promise<CommitFiles>>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** Показать окно для текущего репозитория (уже открыто для него — просто показать). */
  async show(): Promise<void> {
    const root = await currentRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(
        'DiffScope: откройте папку или файл из git-репозитория.',
      );
      return;
    }
    if (this.tab && !this.tab.disposed && this.root === root) {
      this.tab.panel.reveal();
      return;
    }
    if (this.tab && !this.tab.disposed) this.tab.panel.dispose();
    this.root = root;
    this.files.clear();
    this.watch(root);
    this.tab = createWebviewTab(this.context, this.log, {
      title: `Git Log: ${basename(root)}`,
      view: 'log',
      handlers: {
        logRefs: async (_params, signal) => refsData(root, signal),
        logOpenCommit: async ({ hash }) => {
          await showCommit(this.context, this.log, root, hash);
          return null;
        },
        logCommits: async ({ ref, skip }, signal) =>
          commitLog(root, { ref, skip, limit: PAGE, signal }),
        logCommitFiles: async ({ hash }, signal) => {
          const [{ files }, message] = await Promise.all([
            this.commitFiles(hash, signal),
            commitMessage(root, hash, signal),
          ]);
          return { files: files.map(toMultiFile), message };
        },
        logFileDiff: async ({ hash, index }, signal) => {
          const { base, files } = await this.commitFiles(hash, signal);
          const file = files[index];
          if (!file) throw new Error('Файл не найден — обновите окно.');
          const short = hash.slice(0, 7);
          const left: Revision = {
            kind: 'rev',
            rev: base,
            label: `${short}^`,
            description: 'родитель',
            path: file.oldPath,
          };
          const right: Revision = { kind: 'rev', rev: hash, label: short };
          const uri = vscode.Uri.joinPath(vscode.Uri.file(root), file.path);
          const [l, r]: DiffSide[] = await Promise.all([
            loadSide(root, file.path, uri, left, signal),
            loadSide(root, file.path, uri, right, signal),
          ]);
          return { left: l, right: r };
        },
      },
    });
    this.tab.panel.onDidDispose(() => {
      this.watcher?.dispose();
      this.watcher = undefined;
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.watcher?.dispose();
    if (this.tab && !this.tab.disposed) this.tab.panel.dispose();
  }

  private commitFiles(hash: string, signal: AbortSignal): Promise<CommitFiles> {
    let files = this.files.get(hash);
    if (!files) {
      files = commitFiles(this.root!, hash, signal);
      files.catch(() => this.files.delete(hash));
      this.files.set(hash, files);
      // Старые — вон: Map хранит порядок вставки.
      for (const key of this.files.keys()) {
        if (this.files.size <= FILES_CACHE) break;
        this.files.delete(key);
      }
    }
    return files;
  }

  /** Следить за HEAD и ссылками репозитория: коммит, смена ветки, fetch — обновить окно. */
  private watch(root: string): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    void gitDir(root).then((dir) => {
      if (!dir || this.root !== root) return;
      const pattern = new vscode.RelativePattern(
        vscode.Uri.file(dir),
        '{HEAD,packed-refs,refs/**}',
      );
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const changed = () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.tab?.post({ type: 'logRefresh' }), REFRESH_DELAY_MS);
      };
      watcher.onDidChange(changed);
      watcher.onDidCreate(changed);
      watcher.onDidDelete(changed);
      this.watcher = watcher;
    });
  }
}

function toMultiFile(f: ChangedFile): MultiFile {
  return {
    path: f.path,
    oldPath: f.oldPath,
    status: f.status,
    added: f.added,
    removed: f.removed,
    binary: f.binary,
  };
}

async function refsData(root: string, signal: AbortSignal): Promise<LogRefs> {
  const [refs, head] = await Promise.all([listRefs(root, signal), getHead(root, signal)]);
  const pick = (kind: 'branch' | 'remote' | 'tag') =>
    refs
      .filter((r) => r.kind === kind)
      .map((r) => ({ name: r.name, fullName: r.fullName }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return {
    repo: basename(root),
    head,
    branches: pick('branch'),
    remotes: pick('remote'),
    tags: pick('tag'),
  };
}

/** Папка .git (в worktree — своя), абсолютный путь. */
async function gitDir(root: string): Promise<string | undefined> {
  try {
    const dir = (await gitText(['rev-parse', '--git-dir'], { cwd: root })).trim();
    return dir.startsWith('/') || /^[A-Za-z]:/.test(dir) ? dir : join(root, dir);
  } catch {
    return undefined;
  }
}
