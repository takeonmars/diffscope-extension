// Список коммитов окна Git Log: граф веток слева от сообщения; рисуются только видимые строки,
// у конца списка подгружается следующая порция. Клик по коммиту раскрывает под ним панель
// («аккордеон», как в Git Graph) — линии графа проходят сквозь неё; повторный клик сворачивает.
// ↑/↓ — соседний коммит (панель следует за выбором).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { GraphRow } from '../../../shared/graph';
import type { LogCommitInfo } from '../../../shared/protocol';
import { GraphCell, LANE_WIDTH } from './GraphCell';

export const ROW_HEIGHT = 22;
/** Сколько строк рисовать сверх видимых — чтобы прокрутка не мигала. */
const OVERSCAN = 10;
/** За сколько строк до конца подгружать следующую порцию. */
const LOAD_AHEAD = 40;

interface Props {
  commits: readonly LogCommitInfo[];
  /** Строки графа — по одной на коммит, в том же порядке. */
  graph: readonly GraphRow[];
  hasMore: boolean;
  loading: boolean;
  /** Раскрытый коммит. */
  selected?: string;
  onSelect(hash: string | undefined): void;
  onLoadMore(): void;
  /** Высота раскрытой панели, px. */
  expandedHeight: number;
  renderExpanded(commit: LogCommitInfo): ReactNode;
}

export function CommitList(props: Props) {
  const { commits, graph, hasMore, loading, selected, onSelect, onLoadMore } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  const expanded = selected ? commits.findIndex((c) => c.hash === selected) : -1;
  const extra = expanded === -1 ? 0 : props.expandedHeight;

  useEffect(() => {
    const node = scroller.current!;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setView({ top: node.scrollTop, height: node.clientHeight }),
      );
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  /** Верх строки коммита: строки ниже раскрытой сдвинуты на высоту панели. */
  const rowTop = (i: number) => i * ROW_HEIGHT + (expanded !== -1 && i > expanded ? extra : 0);
  /** Коммит, строка или панель которого на высоте y. */
  const indexAt = (y: number) => {
    const panelTop = (expanded + 1) * ROW_HEIGHT;
    if (expanded === -1 || y < panelTop) return Math.floor(y / ROW_HEIGHT);
    if (y < panelTop + extra) return expanded;
    return Math.floor((y - extra) / ROW_HEIGHT);
  };
  const first = Math.max(0, indexAt(view.top) - OVERSCAN);
  const last = Math.min(commits.length, indexAt(view.top + view.height) + OVERSCAN + 1);

  useEffect(() => {
    if (hasMore && !loading && last >= commits.length - LOAD_AHEAD) onLoadMore();
  }, [hasMore, loading, last, commits.length, onLoadMore]);

  // Раскрытая панель целиком в поле зрения (и строка коммита над ней).
  useEffect(() => {
    if (expanded === -1) return;
    const node = scroller.current!;
    const top = expanded * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT + extra;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bottom > node.scrollTop + node.clientHeight) {
      node.scrollTop = Math.min(top, bottom - node.clientHeight);
    }
  }, [expanded, extra]);

  const select = (i: number) => {
    const commit = commits[Math.max(0, Math.min(commits.length - 1, i))];
    if (commit) onSelect(commit.hash);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 0) / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: page,
      PageUp: -page,
    };
    if (event.key in moves) {
      event.preventDefault();
      select(expanded + moves[event.key]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      select(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      select(commits.length - 1);
    }
  };

  const total = commits.length * ROW_HEIGHT + extra + (hasMore ? ROW_HEIGHT : 0);
  const expandedCommit = expanded !== -1 ? commits[expanded] : undefined;

  return (
    <div
      className="log-commits"
      ref={scroller}
      tabIndex={0}
      onKeyDown={onKeyDown}
      role="listbox"
      aria-label="Коммиты"
    >
      <div style={{ height: total }}>
        {commits.slice(first, last).map((commit, i) => (
          <CommitRow
            key={commit.hash}
            commit={commit}
            graph={graph[first + i]}
            top={rowTop(first + i)}
            selected={commit.hash === selected}
            onClick={() => onSelect(commit.hash === selected ? undefined : commit.hash)}
          />
        ))}
        {expandedCommit && expanded >= first - 1 && expanded < last && (
          <div className="log-expanded" style={{ top: (expanded + 1) * ROW_HEIGHT, height: extra }}>
            <GraphContinuation row={graph[expanded]} height={extra} />
            <div className="log-expanded__content">{props.renderExpanded(expandedCommit)}</div>
          </div>
        )}
        {hasMore && (
          <div className="log-commits__more" style={{ top: commits.length * ROW_HEIGHT + extra }}>
            Загрузка…
          </div>
        )}
      </div>
    </div>
  );
}

/** Линии дорожек, идущих от раскрытого коммита вниз, — сквозь панель, чтобы граф не рвался. */
function GraphContinuation({ row, height }: { row?: GraphRow; height: number }) {
  if (!row) return null;
  const lanes = new Map<number, number>();
  for (const line of row.lines) if (line.to[1] === 2) lanes.set(line.to[0], line.color);
  return (
    <svg
      className="log-graph log-expanded__graph"
      width={row.width * LANE_WIDTH}
      height={height}
      aria-hidden
    >
      {[...lanes].map(([lane, color]) => {
        const x = lane * LANE_WIDTH + LANE_WIDTH / 2;
        return (
          <path key={lane} d={`M${x},0 V${height}`} className={`log-graph__line c${color % 8}`} />
        );
      })}
    </svg>
  );
}

function CommitRow({
  commit,
  graph,
  top,
  selected,
  onClick,
}: {
  commit: LogCommitInfo;
  graph?: GraphRow;
  top: number;
  selected: boolean;
  onClick(): void;
}) {
  return (
    <div
      className={`log-row${selected ? ' is-selected' : ''}${
        commit.parents.length > 1 ? ' is-merge' : ''
      }`}
      style={{ top }}
      onClick={onClick}
      role="option"
      aria-selected={selected}
      aria-expanded={selected}
    >
      <span className="log-row__subject">
        {graph && <GraphCell row={graph} merge={commit.parents.length > 1} />}
        {commit.refs.map((ref) => (
          <span
            key={`${ref.kind}:${ref.name}`}
            className={`log-ref log-ref--${ref.kind}${ref.current ? ' is-current' : ''}`}
            title={ref.kind === 'tag' ? `тег ${ref.name}` : ref.name}
          >
            {ref.name}
          </span>
        ))}
        <span className="log-row__text">{commit.subject}</span>
      </span>
      <span className="log-row__author" title={commit.email}>
        {commit.author}
      </span>
      <span className="log-row__date">{formatDate(commit.date)}</span>
      <span className="log-row__hash">{commit.shortHash}</span>
    </div>
  );
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(navigator.language || 'ru', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
