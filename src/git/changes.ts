// Отличающиеся файлы двух ревизий (функция C, позже D).
import { parseNameStatus, type ChangedFile } from './parsers/nameStatus';
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
  const out = await gitText(
    ['diff', '--name-status', '-z', '-M', '--no-color', '--no-ext-diff', ...revs, '--'],
    { cwd: root, signal },
  );
  return parseNameStatus(out);
}
