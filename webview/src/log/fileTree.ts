// Дерево файлов коммита: папки первыми, по алфавиту; цепочка папок из одной папки сжимается
// в одну строку («src/git»). Без DOM — тестируется отдельно.
import type { MultiFile } from '../../../shared/protocol';

export type TreeNode =
  | { kind: 'folder'; name: string; path: string; children: TreeNode[] }
  | { kind: 'file'; name: string; file: MultiFile; index: number };

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

interface Draft {
  folders: Map<string, Draft>;
  files: { file: MultiFile; index: number }[];
}

const compare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

export function buildTree(files: readonly MultiFile[]): TreeNode[] {
  const root: Draft = { folders: new Map(), files: [] };
  files.forEach((file, index) => {
    let node = root;
    for (const part of file.path.split('/').slice(0, -1)) {
      let next = node.folders.get(part);
      if (!next) node.folders.set(part, (next = { folders: new Map(), files: [] }));
      node = next;
    }
    node.files.push({ file, index });
  });
  return toNodes(root, '');
}

function toNodes(draft: Draft, prefix: string): TreeNode[] {
  const folders = [...draft.folders.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([name, child]): TreeNode => {
      let label = name;
      let path = `${prefix}${name}`;
      let current = child;
      while (!current.files.length && current.folders.size === 1) {
        const [childName, next] = [...current.folders.entries()][0];
        label = `${label}/${childName}`;
        path = `${path}/${childName}`;
        current = next;
      }
      return { kind: 'folder', name: label, path, children: toNodes(current, `${path}/`) };
    });
  const files = [...draft.files]
    .sort((a, b) => compare(baseName(a.file.path), baseName(b.file.path)))
    .map(({ file, index }): TreeNode => ({ kind: 'file', name: baseName(file.path), file, index }));
  return [...folders, ...files];
}

/** Строки дерева для отрисовки: содержимое свёрнутых папок пропускается. */
export function treeRows(
  nodes: readonly TreeNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === 'folder' && !collapsed.has(node.path)) {
      rows.push(...treeRows(node.children, collapsed, depth + 1));
    }
  }
  return rows;
}

/** Номера файлов в порядке дерева — «следующий / предыдущий файл» во всплывающем диффе. */
export function treeOrder(nodes: readonly TreeNode[]): number[] {
  return treeRows(nodes, new Set()).flatMap(({ node }) =>
    node.kind === 'file' ? [node.index] : [],
  );
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
