// Запуск git: отмена (AbortSignal → kill), таймаут, ограничение объёма вывода, данные на stdin.
// Не зависит от vscode — тестируется отдельно. Команды совместимы с git 2.15+.
import { spawn } from 'node:child_process';

export interface GitOptions {
  cwd: string;
  signal?: AbortSignal;
  /** Мс; по умолчанию 30 с. */
  timeout?: number;
  /** Байт stdout; по умолчанию 64 МБ. */
  maxOutput?: number;
  /** Данные для stdin. */
  input?: string;
  /** Коды выхода, которые не считаются ошибкой (например, 1 у `diff --quiet`). */
  okCodes?: readonly number[];
}

export interface GitResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export class GitCancelledError extends Error {
  constructor() {
    super('Отменено');
    this.name = 'GitCancelledError';
  }
}

export interface GitTrace {
  args: readonly string[];
  cwd: string;
  ms: number;
  code: number | null;
  error?: string;
}

let gitPath = 'git';
let trace: ((entry: GitTrace) => void) | undefined;

/** Путь к git — тот же, что у встроенного git-расширения VS Code. */
export function setGitPath(path: string): void {
  gitPath = path;
}

/** Журнал команд — в Output channel расширения. */
export function setGitTrace(fn: ((entry: GitTrace) => void) | undefined): void {
  trace = fn;
}

const ENV = {
  ...process.env,
  // Сообщения git на английском — их разбирают парсеры.
  LC_ALL: 'C',
  // Не брать index.lock ради обновления статистики — расширение только читает.
  GIT_OPTIONAL_LOCKS: '0',
  // Никаких запросов логина: сетевых команд нет, но на всякий случай.
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
};

export function runGit(args: readonly string[], options: GitOptions): Promise<GitResult> {
  const {
    cwd,
    signal,
    timeout = 30_000,
    maxOutput = 64 * 1024 * 1024,
    input,
    okCodes = [0],
  } = options;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GitCancelledError());
      return;
    }
    // core.quotepath=off — пути с не-ASCII символами без экранирования.
    const child = spawn(gitPath, ['-c', 'core.quotepath=off', ...args], {
      cwd,
      env: ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Своя группа процессов: при отмене убиваются и дочерние процессы git (хуки, алиасы).
      detached: process.platform !== 'win32',
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let done = false;

    const finish = (error: Error | undefined, code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      trace?.({ args, cwd, ms: Date.now() - started, code, error: error?.message });
      if (error) reject(error);
      else resolve({ stdout: Buffer.concat(chunks, size), stderr, code: code ?? 0 });
    };
    // Не ждём close: дочерние процессы git могут держать stdout открытым и после kill.
    const kill = (error: Error) => {
      try {
        if (child.pid !== undefined && process.platform !== 'win32')
          process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      child.stdout.destroy();
      child.stderr.destroy();
      finish(error, null);
    };
    const onAbort = () => kill(new GitCancelledError());
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(
      () => kill(new GitError(`git ${args[0]}: превышено время ожидания`, args, null, stderr)),
      timeout,
    );

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOutput) {
        kill(new GitError(`git ${args[0]}: слишком большой вывод`, args, null, stderr));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      const message =
        error.code === 'ENOENT'
          ? `git не найден: ${gitPath}`
          : `Не удалось запустить git: ${error.message}`;
      finish(new GitError(message, args, null, ''), null);
    });
    child.on('close', (code) => {
      if (code !== null && okCodes.includes(code)) finish(undefined, code);
      else {
        const detail = stderr.trim().split('\n')[0] || `код выхода ${code}`;
        finish(new GitError(`git ${args[0]}: ${detail}`, args, code, stderr), code);
      }
    });

    child.stdin.on('error', () => {}); // git мог закрыть stdin раньше — это не ошибка
    child.stdin.end(input);
  });
}

/** stdout как текст UTF-8. */
export async function gitText(args: readonly string[], options: GitOptions): Promise<string> {
  return (await runGit(args, options)).stdout.toString('utf8');
}
