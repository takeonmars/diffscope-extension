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

const emptyTrees = new Map<string, Promise<string>>();

/** Хеш пустого дерева (у SHA-1 и SHA-256 он разный) — «родитель» корневого коммита. */
export function emptyTree(root: string): Promise<string> {
  let tree = emptyTrees.get(root);
  if (!tree) {
    tree = gitText(['hash-object', '-t', 'tree', '--stdin'], { cwd: root, input: '' }).then((t) =>
      t.trim(),
    );
    tree.catch(() => emptyTrees.delete(root));
    emptyTrees.set(root, tree);
  }
  return tree;
}

/** Настоящие родители коммита (без переписывания, как в log -- путь или log -L). */
export async function commitParents(
  root: string,
  hash: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const out = await gitText(['rev-list', '--parents', '-n1', hash], { cwd: root, signal });
  return out.trim().split(' ').slice(1);
}

/**
 * Файлы, изменённые коммитом: против первого родителя (у merge — что пришло в основную ветку),
 * у корневого — против пустого дерева. `base` — ревизия левой стороны.
 */
export async function commitFiles(
  root: string,
  hash: string,
  signal?: AbortSignal,
): Promise<{ base: string; files: ChangedFile[] }> {
  const [parent] = await commitParents(root, hash, signal);
  const base = parent ?? (await emptyTree(root));
  return { base, files: await changedFiles(root, base, hash, 'direct', signal) };
}

/** Сообщение коммита целиком: заголовок и тело. */
export async function commitMessage(
  root: string,
  hash: string,
  signal?: AbortSignal,
): Promise<string> {
  return (await gitText(['log', '-1', '--format=%B', hash, '--'], { cwd: root, signal })).trimEnd();
}
