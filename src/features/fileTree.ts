// Дерево отличающихся файлов для панели: папки первыми, по алфавиту; цепочка папок из одной
// папки сжимается в одну строку («src/git»), как в Source Control.
import type { ChangedFile } from '../git/parsers/nameStatus';

export type FileNode =
  | { kind: 'file'; name: string; file: ChangedFile }
  | { kind: 'folder'; name: string; path: string; children: FileNode[]; count: number };

interface Draft {
  folders: Map<string, Draft>;
  files: ChangedFile[];
}

export function buildFileTree(files: readonly ChangedFile[]): FileNode[] {
  const root: Draft = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part);
      if (!next) node.folders.set(part, (next = { folders: new Map(), files: [] }));
      node = next;
    }
    node.files.push(file);
  }
  return toNodes(root, '');
}

/** Список без папок: файлы по пути. */
export function buildFileList(files: readonly ChangedFile[]): FileNode[] {
  return [...files]
    .sort((a, b) => compare(a.path, b.path))
    .map((file) => ({ kind: 'file', name: baseName(file.path), file }));
}

function toNodes(draft: Draft, prefix: string): FileNode[] {
  const folders = [...draft.folders.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([name, child]) => folder(name, `${prefix}${name}`, child));
  const files = [...draft.files]
    .sort((a, b) => compare(baseName(a.path), baseName(b.path)))
    .map((file): FileNode => ({ kind: 'file', name: baseName(file.path), file }));
  return [...folders, ...files];
}

function folder(name: string, path: string, draft: Draft): FileNode {
  // Сжать: в папке только одна папка и нет файлов.
  let label = name;
  let current = draft;
  let currentPath = path;
  while (current.files.length === 0 && current.folders.size === 1) {
    const [childName, child] = [...current.folders.entries()][0];
    label = `${label}/${childName}`;
    currentPath = `${currentPath}/${childName}`;
    current = child;
  }
  const children = toNodes(current, `${currentPath}/`);
  return { kind: 'folder', name: label, path: currentPath, children, count: countFiles(children) };
}

function countFiles(nodes: readonly FileNode[]): number {
  return nodes.reduce((n, node) => n + (node.kind === 'file' ? 1 : node.count), 0);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function compare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}
