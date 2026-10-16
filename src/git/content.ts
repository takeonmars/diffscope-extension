// Содержимое файла на ревизии. `git cat-file --batch-check` даёт хеш blob и размер за один вызов;
// текст кешируется по хешу blob — одинаковые версии файла в разных коммитах читаются один раз.
import { LruCache } from './cache';
import { runGit } from './runner';

export type FileContent =
  | { kind: 'text'; text: string; blob: string }
  | { kind: 'binary'; size: number; blob: string }
  | { kind: 'tooLarge'; size: number; blob: string }
  /** Файла нет на этой ревизии (добавлен позже или удалён). */
  | { kind: 'missing' };

export interface ContentOptions {
  signal?: AbortSignal;
  /** Байт; больше — без содержимого. По умолчанию 5 МБ. */
  maxSize?: number;
}

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024;
/** Как git: NUL в первых 8000 байтах — двоичный файл. */
const BINARY_PROBE = 8000;

const cache = new LruCache<string, FileContent>(64 * 1024 * 1024, (c) =>
  c.kind === 'text' ? c.text.length * 2 : 64,
);

/**
 * Файл `path` (относительно корня, через «/») на ревизии `rev` (хеш, ветка, тег, HEAD).
 * Сабмодуль показывается строкой «Subproject commit <хеш>», как в `git diff`.
 */
export async function fileAtRevision(
  root: string,
  rev: string,
  path: string,
  { signal, maxSize = DEFAULT_MAX_SIZE }: ContentOptions = {},
): Promise<FileContent> {
  const check = await runGit(['cat-file', '--batch-check'], {
    cwd: root,
    signal,
    input: `${rev}:${path}\n`,
  });
  const info = parseBatchCheck(check.stdout.toString('utf8'));
  if (!info) return { kind: 'missing' };
  if (info.type === 'commit') {
    return { kind: 'text', text: `Subproject commit ${info.object}\n`, blob: info.object };
  }
  if (info.type !== 'blob') return { kind: 'missing' }; // путь — папка
  if (info.size > maxSize) return { kind: 'tooLarge', size: info.size, blob: info.object };

  const cached = cache.get(info.object);
  if (cached) return cached;
  const { stdout } = await runGit(['cat-file', 'blob', info.object], {
    cwd: root,
    signal,
    maxOutput: maxSize + 1,
  });
  const content = decode(stdout, info.object);
  cache.set(info.object, content);
  return content;
}

export function parseBatchCheck(
  output: string,
): { object: string; type: string; size: number } | undefined {
  // «<хеш> <тип> <размер>» или «<запрос> missing» / «<запрос> ambiguous».
  const match = /^([0-9a-f]{40,64}) (\w+) (\d+)$/.exec(output.trim());
  return match ? { object: match[1], type: match[2], size: Number(match[3]) } : undefined;
}

export function decode(bytes: Buffer, blob: string): FileContent {
  if (bytes.subarray(0, BINARY_PROBE).includes(0)) {
    return { kind: 'binary', size: bytes.length, blob };
  }
  // UTF-8 без ошибок на неверных байтах (заменяются на «�»); BOM убирается.
  const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes);
  return { kind: 'text', text, blob };
}

/** Для тестов. */
export function clearContentCache(): void {
  cache.clear();
}
