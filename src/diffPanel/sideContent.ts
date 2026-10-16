// Содержимое стороны диффа: файл на ревизии (git) или рабочая копия (открытый текст / диск).
import * as vscode from 'vscode';
import type { DiffSide, SideContent } from '../../shared/protocol';
import { decode, fileAtRevision, type FileContent } from '../git/content';
import { revisionLabel, type Revision } from './session';

/** Порог размера файла для диффа, байт. Позже — настройка. */
const MAX_SIZE = 5 * 1024 * 1024;

export async function loadSide(
  root: string,
  path: string,
  uri: vscode.Uri,
  revision: Revision,
  signal: AbortSignal,
): Promise<DiffSide> {
  const sidePath = revision.kind === 'rev' ? (revision.path ?? path) : path;
  const content =
    revision.kind === 'worktree'
      ? await workingCopy(uri)
      : toSide(await fileAtRevision(root, revision.rev, sidePath, { signal, maxSize: MAX_SIZE }));
  return {
    label: revisionLabel(revision),
    description: revision.kind === 'rev' ? revision.description : 'текущее состояние файла',
    path: sidePath !== path ? sidePath : undefined,
    content,
  };
}

/** Текст открытого документа (с несохранёнными правками) или файл с диска. */
async function workingCopy(uri: vscode.Uri): Promise<SideContent> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return { kind: 'text', text: open.getText() };
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_SIZE) return { kind: 'tooLarge', size: stat.size };
    return toSide(decode(Buffer.from(await vscode.workspace.fs.readFile(uri)), ''));
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
      return { kind: 'missing' };
    }
    throw error;
  }
}

function toSide(content: FileContent): SideContent {
  switch (content.kind) {
    case 'text':
      return { kind: 'text', text: content.text };
    case 'binary':
    case 'tooLarge':
      return { kind: content.kind, size: content.size };
    case 'missing':
      return { kind: 'missing' };
  }
}
