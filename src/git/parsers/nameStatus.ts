// Разбор `git diff --name-status -z`: «M\0путь\0», «R087\0старый\0новый\0».

export type ChangeStatus =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typeChanged' | 'unmerged' | 'unknown';

export interface ChangedFile {
  status: ChangeStatus;
  /** Путь на правой стороне (у удалённого — на левой). */
  path: string;
  /** Путь на левой стороне — у переименованных и скопированных. */
  oldPath?: string;
  /** Процент сходства для переименованных и скопированных. */
  similarity?: number;
}

const STATUS: Record<string, ChangeStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typeChanged',
  U: 'unmerged',
};

export function parseNameStatus(output: string): ChangedFile[] {
  const parts = output.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length;) {
    const code = parts[i++];
    if (!code) continue;
    const status = STATUS[code[0]] ?? 'unknown';
    if (status === 'renamed' || status === 'copied') {
      const oldPath = parts[i++];
      const path = parts[i++];
      files.push({ status, path, oldPath, similarity: Number(code.slice(1)) || undefined });
    } else {
      files.push({ status, path: parts[i++] });
    }
  }
  return files;
}
