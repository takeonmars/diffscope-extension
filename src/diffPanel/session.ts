// Состояние вкладки диффа: файл и ревизии двух сторон; обработчики запросов вкладки.
// Загрузка содержимого и выбор ревизии передаются снаружи — без vscode, тестируется отдельно.
import type { DiffData, DiffSide, SideName } from '../../shared/protocol';
import type { Handlers } from './messageRouter';

export type Revision =
  /** Рабочая копия: открытый в редакторе текст или файл на диске. */
  | { kind: 'worktree' }
  | {
      kind: 'rev';
      /** То, что понимает git: хеш, refs/heads/main, HEAD. */
      rev: string;
      label: string;
      description?: string;
      /** Путь файла на этой ревизии, если он другой (файл переименован позже). */
      path?: string;
    };

export const WORKTREE: Revision = { kind: 'worktree' };

export function revisionLabel(revision: Revision): string {
  return revision.kind === 'worktree' ? 'Рабочая копия' : revision.label;
}

export interface SessionDeps {
  loadSide(revision: Revision, signal: AbortSignal): Promise<DiffSide>;
  /** Выбор ревизии; undefined — пользователь закрыл список. */
  pickRevision(side: SideName, current: Revision): Promise<Revision | undefined>;
  /** Ревизии сменились — обновить заголовок вкладки. */
  onChange?(session: DiffSession): void;
}

export type Fragment = NonNullable<DiffData['fragment']>;

export class DiffSession {
  constructor(
    public path: string,
    public left: Revision,
    public right: Revision,
    private readonly deps: SessionDeps,
    /** История по строкам: фрагмент в обеих версиях. */
    public fragment?: Fragment,
  ) {}

  /** Показать другой файл или другие ревизии в той же вкладке. */
  retarget(path: string, left: Revision, right: Revision, fragment?: Fragment): void {
    this.path = path;
    this.left = left;
    this.right = right;
    this.fragment = fragment;
    this.deps.onChange?.(this);
  }

  get title(): string {
    const name = this.path.split('/').pop() ?? this.path;
    return `${name} (${revisionLabel(this.left)} ↔ ${revisionLabel(this.right)})`;
  }

  handlers(): Omit<Handlers, 'saveLayout'> {
    return {
      load: async (_params, signal) => {
        const [left, right] = await Promise.all([
          this.deps.loadSide(this.left, signal),
          this.deps.loadSide(this.right, signal),
        ]);
        return { path: this.path, left, right, fragment: this.fragment };
      },
      pickRef: async ({ side }) => {
        const picked = await this.deps.pickRevision(side, this[side]);
        if (!picked) return { changed: false };
        this[side] = picked;
        // Фрагмент найден для прежних ревизий — к новой он не относится.
        this.fragment = undefined;
        this.deps.onChange?.(this);
        return { changed: true };
      },
      swap: async () => {
        [this.left, this.right] = [this.right, this.left];
        if (this.fragment) this.fragment = { left: this.fragment.right, right: this.fragment.left };
        this.deps.onChange?.(this);
        return null;
      },
    };
  }
}
