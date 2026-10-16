// Тестовые данные для vite dev в браузере: две версии файла без git.

export interface Sample {
  name: string;
  a: string;
  b: string;
}

const smallA = `import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Настройки по умолчанию
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRIES = 3;

export interface Options {
  timeout?: number;
  retries?: number;
}

export async function loadConfig(dir: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(dir, 'config.json'), 'utf8');
  return JSON.parse(text);
}

export function withDefaults(options: Options): Required<Options> {
  return {
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    retries: options.retries ?? DEFAULT_RETRIES,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(fn: () => Promise<T>, options: Options = {}): Promise<T> {
  const { retries } = withDefaults(options);
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw lastError;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return ms + ' ms';
  return (ms / 1000).toFixed(1) + ' s';
}

export function parseList(value: string): string[] {
  return value.split(',');
}

export const VERSION = '1.0.0';
`;

const smallB = `import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Настройки по умолчанию
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF = 2;

export interface Options {
  timeout?: number;
  retries?: number;
  /** Множитель паузы между попытками. */
  backoff?: number;
}

export async function loadConfig(dir: string): Promise<Record<string, unknown>> {
  const path = resolve(join(dir, 'config.json'));
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}

export function withDefaults(options: Options): Required<Options> {
  return {
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    retries: options.retries ?? DEFAULT_RETRIES,
    backoff: options.backoff ?? DEFAULT_BACKOFF,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(fn: () => Promise<T>, options: Options = {}): Promise<T> {
  const { retries, backoff } = withDefaults(options);
  let lastError: unknown;
  let delay = 100;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await sleep(delay);
      delay *= backoff;
    }
  }
  throw lastError;
}

export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const VERSION = '1.1.0';
`;

/**
 * Большой файл: исходный пример, повторённый много раз, с изменениями в разных местах —
 * правка строки, вставка и удаление блоков. Детерминированный.
 */
function generateLarge(copies: number): Sample {
  const base = smallA.split('\n');
  const a: string[] = [];
  const b: string[] = [];
  for (let i = 0; i < copies; i++) {
    const block = base.map((line) =>
      line.replace(/loadConfig|withDefaults|retry\b/g, (m) => `${m}${i}`),
    );
    a.push(`// --- Раздел ${i} ---`, ...block);
    const changed = [...block];
    switch (i % 4) {
      case 0:
        changed[4] = `const DEFAULT_TIMEOUT = ${1000 * (i + 1)};`;
        break;
      case 1:
        changed.splice(20, 0, `  // добавлено в разделе ${i}`, `  console.log('раздел ${i}');`);
        break;
      case 2:
        changed.splice(44, 4);
        break;
      case 3:
        break;
    }
    b.push(`// --- Раздел ${i} ---`, ...changed);
  }
  return { name: `Большой файл (${a.length} строк)`, a: a.join('\n'), b: b.join('\n') };
}

export const samples: Sample[] = [
  { name: 'Небольшой файл', a: smallA, b: smallB },
  generateLarge(100),
  { name: 'Без изменений', a: smallA, b: smallA },
];
