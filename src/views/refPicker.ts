// Выбор ревизии: QuickPick VS Code с разделами (рабочая копия, HEAD, ветки, удалённые ветки,
// теги, последние коммиты) и поиском коммитов по хешу и сообщению по мере ввода.
import * as vscode from 'vscode';
import type { Commit } from '../git/parsers/log';
import { getHead, listRefs, recentCommits, searchCommits, type Ref } from '../git/refs';
import { WORKTREE, type Revision } from '../diffPanel/session';

interface RevisionItem extends vscode.QuickPickItem {
  revision?: Revision;
  /** Ревизия, выбранная сейчас: на ней курсор при открытии. */
  current?: boolean;
}

const SEARCH_DELAY_MS = 250;
const ICONS: Record<Ref['kind'], string> = { branch: 'git-branch', remote: 'cloud', tag: 'tag' };
const SECTIONS: [Ref['kind'], string][] = [
  ['branch', 'Локальные ветки'],
  ['remote', 'Удалённые ветки'],
  ['tag', 'Теги'],
];

export interface PickOptions {
  /** Показывать «Рабочую копию» (нет — для базы сравнения веток). По умолчанию — да. */
  worktree?: boolean;
  /** Подпись рабочей копии. */
  worktreeDescription?: string;
}

export function pickRevision(
  root: string,
  title: string,
  current: Revision,
  options: PickOptions = {},
): Promise<Revision | undefined> {
  const pick = vscode.window.createQuickPick<RevisionItem>();
  pick.title = title;
  pick.placeholder =
    'Ветка, тег, коммит или рабочая копия; хеш или текст сообщения — поиск коммита';
  pick.matchOnDescription = true;
  pick.matchOnDetail = true;
  pick.busy = true;
  const controller = new AbortController();
  let base: RevisionItem[] = [];
  let found: RevisionItem[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    pick.items = found.length ? [separator('Найденные коммиты'), ...found, ...base] : base;
  };

  void loadBase(root, current, options, controller.signal).then(
    (items) => {
      base = items;
      pick.busy = false;
      render();
      const selected = items.find((i) => i.current);
      if (selected) pick.activeItems = [selected];
    },
    (error: Error) => {
      pick.busy = false;
      if (!controller.signal.aborted) {
        void vscode.window.showErrorMessage(`Не удалось получить ревизии: ${error.message}`);
      }
    },
  );

  let search: AbortController | undefined;
  pick.onDidChangeValue((value) => {
    clearTimeout(timer);
    search?.abort();
    if (value.trim().length < 2) {
      found = [];
      render();
      return;
    }
    timer = setTimeout(() => {
      search = new AbortController();
      const signal = search.signal;
      pick.busy = true;
      searchCommits(root, value, 30, signal).then(
        (commits) => {
          if (signal.aborted) return;
          // alwaysShow: QuickPick не должен скрывать найденное своим фильтром по подписи.
          found = commits.map((c) => ({ ...commitItem(c), alwaysShow: true }));
          pick.busy = false;
          render();
        },
        () => {
          if (!signal.aborted) pick.busy = false;
        },
      );
    }, SEARCH_DELAY_MS);
  });

  return new Promise((resolve) => {
    pick.onDidAccept(() => {
      const revision = pick.selectedItems[0]?.revision;
      if (!revision) return;
      resolve(revision);
      pick.hide();
    });
    pick.onDidHide(() => {
      clearTimeout(timer);
      controller.abort();
      search?.abort();
      pick.dispose();
      resolve(undefined);
    });
    pick.show();
  });
}

async function loadBase(
  root: string,
  current: Revision,
  options: PickOptions,
  signal: AbortSignal,
): Promise<RevisionItem[]> {
  const [head, refs, commits] = await Promise.all([
    getHead(root, signal),
    listRefs(root, signal),
    recentCommits(root, 30, signal),
  ]);
  const isCurrent = (r: Revision) =>
    current.kind === r.kind &&
    (r.kind === 'worktree' || (current.kind === 'rev' && current.rev === r.rev));
  const mark = (item: RevisionItem): RevisionItem =>
    item.revision && isCurrent(item.revision)
      ? { ...item, current: true, description: `сейчас · ${item.description ?? ''}` }
      : item;

  const items: RevisionItem[] =
    options.worktree === false
      ? []
      : [
          {
            label: '$(file) Рабочая копия',
            description: options.worktreeDescription ?? 'текущее состояние файла на диске',
            revision: WORKTREE,
          },
        ];
  if (head.commit) {
    items.push({
      label: '$(git-commit) HEAD',
      description: head.branch ? `ветка ${head.branch}` : 'detached HEAD',
      detail: commits[0]?.subject,
      revision: {
        kind: 'rev',
        rev: 'HEAD',
        label: 'HEAD',
        description: head.branch ? `ветка ${head.branch}` : commits[0]?.subject,
      },
    });
  }
  for (const [kind, title] of SECTIONS) {
    const section = refs.filter((r) => r.kind === kind);
    if (!section.length) continue;
    items.push(separator(title));
    for (const ref of section) {
      items.push({
        label: `$(${ICONS[kind]}) ${ref.name}`,
        description: ref.subject,
        revision: { kind: 'rev', rev: ref.fullName, label: ref.name, description: ref.subject },
      });
    }
  }
  if (commits.length) {
    items.push(separator('Последние коммиты'));
    items.push(...commits.map(commitItem));
  }
  return items.map(mark);
}

function commitItem(commit: Commit): RevisionItem {
  return {
    label: `$(git-commit) ${commit.shortHash}`,
    description: commit.subject,
    detail: `${commit.author} · ${formatDate(commit.date)}`,
    revision: {
      kind: 'rev',
      rev: commit.hash,
      label: commit.shortHash,
      description: commit.subject,
    },
  };
}

function separator(label: string): RevisionItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(vscode.env.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
