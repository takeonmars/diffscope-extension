// Состояние вкладки диффа: файл и ревизии двух сторон; обработчики запросов вкладки.
// Загрузка содержимого и выбор ревизии передаются снаружи — без vscode, тестируется отдельно.
import type { DiffSide, SideName } from '../../shared/protocol';
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

export class DiffSession {
  constructor(
    readonly path: string,
    public left: Revision,
    public right: Revision,
    private readonly deps: SessionDeps,
  ) {}

  get title(): string {
    const name = this.path.split('/').pop() ?? this.path;
    return `${name} (${revisionLabel(this.left)} ↔ ${revisionLabel(this.right)})`;
  }

  handlers(): Handlers {
    return {
      load: async (_params, signal) => {
        const [left, right] = await Promise.all([
          this.deps.loadSide(this.left, signal),
          this.deps.loadSide(this.right, signal),
        ]);
        return { path: this.path, left, right };
      },
      pickRef: async ({ side }) => {
        const picked = await this.deps.pickRevision(side, this[side]);
        if (!picked) return { changed: false };
        this[side] = picked;
        this.deps.onChange?.(this);
        return { changed: true };
      },
      swap: async () => {
        [this.left, this.right] = [this.right, this.left];
        this.deps.onChange?.(this);
        return null;
      },
    };
  }
}
