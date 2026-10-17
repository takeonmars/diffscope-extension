// Окно Git Log — вкладка редактора: коммиты с графом веток. Клик по коммиту раскрывает под ним
// панель (как в Git Graph): дерево файлов и описание коммита. Клик по файлу — дифф во
// всплывающем окне поверх лога (не поверх VS Code). Ветка — выпадающим списком сверху.
// Esc — закрыть дифф, затем свернуть коммит.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { layoutGraph } from '../../../shared/graph';
import type { Layout, LogCommitInfo, LogRefs, MultiFile } from '../../../shared/protocol';
import { CancelledError } from '../bridge';
import { DEFAULT_SPLIT } from '../diff/splitter';
import { bridge } from '../vscodeApi';
import { CommitDetails } from './CommitDetails';
import { CommitList } from './CommitList';
import { DiffPane } from './DiffPane';
import { buildTree, treeOrder } from './fileTree';

const ALL = '';
/** Высота раскрытой под коммитом панели, px. */
const EXPANDED_HEIGHT = 260;

interface CommitFiles {
  hash: string;
  files?: MultiFile[];
  message?: string;
  error?: string;
}

export function LogApp({ layout }: { layout?: Layout }) {
  const [refs, setRefs] = useState<LogRefs>();
  const [filter, setFilter] = useState(ALL);
  const [commits, setCommits] = useState<LogCommitInfo[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [details, setDetails] = useState<CommitFiles>();
  /** Всплывающий дифф: файл коммита по номеру в списке файлов. */
  const [modal, setModal] = useState<{ hash: string; index: number }>();
  const [split, setSplit] = useState(layout?.split ?? DEFAULT_SPLIT);
  /** Номер загрузки: ответы прежних (смена ветки, обновление) отбрасываются. */
  const generation = useRef(0);
  const state = useRef({ commits, loading, filter, modal });
  state.current = { commits, loading, filter, modal };
  const graph = useMemo(() => layoutGraph(commits), [commits]);

  const loadCommits = useCallback((ref: string, skip: number) => {
    const gen = generation.current;
    setLoading(true);
    bridge.request('logCommits', { ref: ref || undefined, skip }).promise.then(
      (page) => {
        if (gen !== generation.current) return;
        setCommits((prev) => (skip ? [...prev, ...page.commits] : page.commits));
        setHasMore(page.hasMore);
        setLoading(false);
      },
      (e: Error) => {
        if (gen !== generation.current || e instanceof CancelledError) return;
        setLoading(false);
        setError(e.message);
      },
    );
  }, []);

  /** Ветки и первая порция коммитов текущего фильтра заново. */
  const reload = useCallback(() => {
    generation.current++;
    const gen = generation.current;
    setError(undefined);
    bridge.request('logRefs', {}).promise.then(
      (result) => {
        if (gen !== generation.current || !result) return;
        setRefs(result);
        const all = [...result.branches, ...result.remotes, ...result.tags].map((r) => r.fullName);
        const current = state.current.filter;
        // Отфильтрованной ветки больше нет — показать все.
        const keep = current && (current === 'HEAD' || all.includes(current)) ? current : ALL;
        if (keep !== current) setFilter(keep);
        loadCommits(keep, 0);
      },
      (e: Error) => {
        if (gen === generation.current && !(e instanceof CancelledError)) setError(e.message);
      },
    );
  }, [loadCommits]);

  useEffect(() => {
    const off = bridge.onEvent((event) => {
      if (event.type === 'logRefresh') reload();
    });
    reload();
    return off;
  }, [reload]);

  // Файлы и сообщение раскрытого коммита.
  useEffect(() => {
    if (!selected) return;
    setDetails({ hash: selected });
    const req = bridge.requestLatest('logCommitFiles', { hash: selected });
    req.promise.then(
      ({ files, message }) => setDetails({ hash: selected, files, message }),
      (e: Error) => {
        if (!(e instanceof CancelledError)) setDetails({ hash: selected, error: e.message });
      },
    );
  }, [selected]);

  // Esc — сначала закрыть дифф, потом свернуть коммит.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (state.current.modal) setModal(undefined);
      else setSelected(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectFilter = (ref: string) => {
    generation.current++;
    setFilter(ref);
    setCommits([]);
    setSelected(undefined);
    setHasMore(false);
    loadCommits(ref, 0);
  };

  const loadMore = useCallback(() => {
    const { commits: list, loading: busy, filter: ref } = state.current;
    if (!busy) loadCommits(ref, list.length);
  }, [loadCommits]);

  const files = details?.hash === selected ? details?.files : undefined;
  // Соседние файлы во всплывающем диффе — в порядке дерева.
  const order = useMemo(() => treeOrder(buildTree(files ?? [])), [files]);
  const modalFile = modal && modal.hash === details?.hash ? files?.[modal.index] : undefined;
  const position = modal ? order.indexOf(modal.index) : -1;
  const step = (dir: 1 | -1) => {
    const next = order[position + dir];
    if (modal && next !== undefined) setModal({ hash: modal.hash, index: next });
  };

  return (
    <div className="log">
      <div className="log-center__header">
        <select
          value={filter}
          onChange={(e) => selectFilter(e.target.value)}
          aria-label="Ветка"
          title="Показать коммиты ветки"
        >
          <option value={ALL}>Все ветки</option>
          {refs?.head?.commit && (
            <option value="HEAD">
              HEAD{refs.head.branch ? ` (${refs.head.branch})` : ' (detached)'}
            </option>
          )}
          {(
            [
              ['branches', 'Локальные'],
              ['remotes', 'Удалённые'],
              ['tags', 'Теги'],
            ] as const
          ).map(
            ([key, label]) =>
              !!refs?.[key].length && (
                <optgroup key={key} label={label}>
                  {refs[key].map((r) => (
                    <option key={r.fullName} value={r.fullName}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              ),
          )}
        </select>
        <span className="log-center__count">
          {commits.length ? `${commits.length}${hasMore ? '+' : ''} коммитов` : ''}
        </span>
        <button onClick={reload} title="Обновить">
          ⟳
        </button>
      </div>
      {error ? (
        <div className="log-empty error">
          {error} <button onClick={reload}>Повторить</button>
        </div>
      ) : (
        <CommitList
          commits={commits}
          graph={graph}
          hasMore={hasMore}
          loading={loading}
          selected={selected}
          onSelect={setSelected}
          onLoadMore={loadMore}
          expandedHeight={EXPANDED_HEIGHT}
          renderExpanded={(commit) => (
            <CommitDetails
              commit={commit}
              files={files}
              message={details?.hash === commit.hash ? details.message : undefined}
              error={details?.hash === commit.hash ? details.error : undefined}
              active={modal?.hash === commit.hash ? modal.index : undefined}
              onOpen={(index) => setModal({ hash: commit.hash, index })}
            />
          )}
        />
      )}
      {modal && modalFile && (
        <div
          className="log-modal"
          onMouseDown={(e) => e.target === e.currentTarget && setModal(undefined)}
        >
          <div className="log-modal__window" role="dialog" aria-label={`Дифф ${modalFile.path}`}>
            <DiffPane
              key={`${modal.hash}:${modal.index}`}
              hash={modal.hash}
              index={modal.index}
              path={modalFile.path}
              split={split}
              onSplitChange={(ratio) => {
                setSplit(ratio);
                void bridge.request('saveLayout', { split: ratio }).promise.catch(() => {});
              }}
              actions={
                <span className="log-modal__actions">
                  <button onClick={() => step(-1)} disabled={position <= 0} title="Предыдущий файл">
                    ‹
                  </button>
                  <span className="nav__counter">
                    {position + 1} / {order.length}
                  </span>
                  <button
                    onClick={() => step(1)}
                    disabled={position >= order.length - 1}
                    title="Следующий файл"
                  >
                    ›
                  </button>
                  <button onClick={() => setModal(undefined)} title="Закрыть (Esc)">
                    ✕
                  </button>
                </span>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
