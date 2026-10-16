// Отличающиеся файлы двух ревизий (функция C, позже D).
import { parseNameStatus, parseNumstat, type ChangedFile } from './parsers/nameStatus';
import { gitText } from './runner';

/**
 * - `pr` — как в PR (`A...B`): только изменения B с момента расхождения с A;
 * - `direct` — прямое (`A B`): все отличия деревьев двух ревизий.
 */
export type CompareMode = 'pr' | 'direct';

/** Файлы, отличающиеся между `a` и `b`; `b` не указан — рабочая копия (только для `direct`). */
export async function changedFiles(
  root: string,
  a: string,
  b: string | undefined,
  mode: CompareMode,
  signal?: AbortSignal,
): Promise<ChangedFile[]> {
  const revs = b === undefined ? [a] : mode === 'pr' ? [`${a}...${b}`] : [a, b];
  const run = (format: string) =>
    gitText(['diff', format, '-z', '-M', '--no-color', '--no-ext-diff', ...revs, '--'], {
      cwd: root,
      signal,
    });
  // Статусы и число строк — два прохода diff по одним ревизиям; git кеширует объекты.
  const [names, numbers] = await Promise.all([run('--name-status'), run('--numstat')]);
  const stats = new Map(parseNumstat(numbers).map((s) => [s.path, s]));
  return parseNameStatus(names).map((file) => {
    const stat = stats.get(file.path);
    return stat
      ? stat.binary
        ? { ...file, binary: true }
        : { ...file, added: stat.added, removed: stat.removed }
      : file;
  });
}
