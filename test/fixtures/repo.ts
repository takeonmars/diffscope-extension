// Тестовые репозитории: настоящий git во временной папке. Даты коммитов фиксированы.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TestRepo {
  root: string;
  git(...args: string[]): string;
  /** Записать файлы (null — удалить) и закоммитить; возвращает хеш коммита. */
  commit(message: string, files: Record<string, string | Buffer | null>): string;
  write(path: string, content: string | Buffer): void;
  remove(): void;
}

let time = Date.UTC(2026, 0, 1) / 1000;

export function makeRepo(): TestRepo {
  // realpath: на macOS tmpdir — ссылка /var → /private/var.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'diffscope-test-')));
  const git = (...args: string[]) => {
    const date = `${time} +0000`;
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Тест',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Тест',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
        LC_ALL: 'C',
      },
    });
  };
  const write = (path: string, content: string | Buffer) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  git('init', '-q');
  // git init -b появился только в 2.28.
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  git('config', 'core.autocrlf', 'false');

  return {
    root,
    git,
    write,
    commit(message, files) {
      for (const [path, content] of Object.entries(files)) {
        if (content === null) git('rm', '-q', path);
        else {
          write(path, content);
          git('add', path);
        }
      }
      time += 3600;
      git('commit', '-q', '-m', message);
      return git('rev-parse', 'HEAD').trim();
    },
    remove() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Двоичный «PNG»: NUL в начале. */
export const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x0d, 0xff]);
