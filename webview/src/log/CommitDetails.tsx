// Раскрытая под коммитом панель окна Git Log (как в Git Graph): слева дерево файлов коммита со
// статусами и «+N −M» — клик открывает дифф во всплывающем окне; справа — сообщение целиком,
// автор, дата, хеш, родители, метки; «Все файлы коммита» — вкладка «все файлы».
import { useMemo, useState } from 'react';
import type { LogCommitInfo, MultiFile } from '../../../shared/protocol';
import { bridge } from '../vscodeApi';
import { formatDate } from './CommitList';
import { buildTree, treeRows } from './fileTree';

const STATUS_LETTER: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typeChanged: 'T',
  unmerged: 'U',
};

interface Props {
  commit: LogCommitInfo;
  files?: MultiFile[];
  message?: string;
  error?: string;
  /** Файл, открытый во всплывающем диффе, — подсвечен. */
  active?: number;
  onOpen(index: number): void;
}

export function CommitDetails({ commit, files, message, error, active, onOpen }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const tree = useMemo(() => buildTree(files ?? []), [files]);
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const [subject, ...body] = (message ?? commit.subject).split('\n');

  return (
    <div className="log-details">
      <div className="log-details__files" role="tree" aria-label="Файлы коммита">
        {error ? (
          <div className="log-details__note error">{error}</div>
        ) : !files ? (
          <div className="log-details__note">Загрузка…</div>
        ) : !files.length ? (
          <div className="log-details__note">Коммит не меняет файлы.</div>
        ) : (
          treeRows(tree, collapsed).map(({ node, depth }) =>
            node.kind === 'folder' ? (
              <button
                key={`d:${node.path}`}
                className="log-tree__row log-tree__folder"
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => toggle(node.path)}
                role="treeitem"
                aria-expanded={!collapsed.has(node.path)}
              >
                <span className="log-tree__chevron">{collapsed.has(node.path) ? '▸' : '▾'}</span>
                {node.name}
              </button>
            ) : (
              <button
                key={`f:${node.file.path}`}
                className={`log-tree__row log-tree__file${node.index === active ? ' is-active' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 + 14 }}
                onClick={() => onOpen(node.index)}
                title={
                  node.file.oldPath ? `${node.file.oldPath} → ${node.file.path}` : node.file.path
                }
                role="treeitem"
              >
                <span className={`log-tree__status file-header__status--${node.file.status}`}>
                  {STATUS_LETTER[node.file.status] ?? '?'}
                </span>
                <span className={`log-tree__name log-tree__name--${node.file.status}`}>
                  {node.name}
                </span>
                {node.file.oldPath && <span className="log-tree__old">← {node.file.oldPath}</span>}
                <span className="log-tree__stats">
                  {node.file.binary ? (
                    'bin'
                  ) : (
                    <>
                      <span className="stats__added">+{node.file.added ?? 0}</span>{' '}
                      <span className="stats__removed">−{node.file.removed ?? 0}</span>
                    </>
                  )}
                </span>
              </button>
            ),
          )
        )}
      </div>
      <div className="log-details__info">
        <div className="log-details__head">
          <div className="log-details__subject">{subject}</div>
          {!!files?.length && (
            <button
              className="log-details__all"
              onClick={() => void bridge.request('logOpenCommit', { hash: commit.hash }).promise}
              title="Все файлы коммита в одной вкладке, сплошной прокруткой"
            >
              Все файлы коммита
            </button>
          )}
        </div>
        {body.join('\n').trim() && (
          <pre className="log-details__body">{body.join('\n').trim()}</pre>
        )}
        <dl className="log-details__meta">
          <dt>Автор</dt>
          <dd>
            {commit.author} &lt;{commit.email}&gt;
          </dd>
          <dt>Дата</dt>
          <dd>{formatDate(commit.date)}</dd>
          <dt>Коммит</dt>
          <dd className="log-details__hash">{commit.hash}</dd>
          {commit.parents.length > 0 && (
            <>
              <dt>{commit.parents.length > 1 ? 'Родители' : 'Родитель'}</dt>
              <dd className="log-details__hash">
                {commit.parents.map((p) => p.slice(0, 7)).join(', ')}
                {commit.parents.length > 1 && ' (файлы — против первого)'}
              </dd>
            </>
          )}
          {commit.refs.length > 0 && (
            <>
              <dt>Метки</dt>
              <dd>
                {commit.refs.map((ref) => (
                  <span key={`${ref.kind}:${ref.name}`} className={`log-ref log-ref--${ref.kind}`}>
                    {ref.name}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
