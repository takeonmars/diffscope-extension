import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffData, SideName } from '../../shared/protocol';
import { CancelledError } from './bridge';
import { DiffStats } from './components/DiffStats/DiffStats';
import {
  DiffView,
  type DiffController,
  type DiffMode,
  type DiffSummary,
} from './components/DiffView/DiffView';
import { Loader } from './components/Loader/Loader';
import { Placeholder, sideText, unviewableReason } from './components/Placeholder/Placeholder';
import { RevisionBar } from './components/RevisionBar/RevisionBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { DEFAULT_SPLIT } from './diff/splitter';
import { useThemeKind } from './theme/useThemeKind';
import { bridge } from './vscodeApi';

const MODES: [DiffMode, string, string][] = [
  ['ribbons', 'Ленты', 'Две колонки без выравнивания, ленты соединяют блоки'],
  ['aligned', 'MergeView', 'Две колонки выровнены: напротив вставки — пустое место'],
  ['unified', '1 колонка', 'Удалённые строки над добавленными'],
];

type Status =
  | { state: 'loading'; cancel(): void }
  | { state: 'ready' }
  | { state: 'cancelled' }
  | { state: 'error'; message: string };

/** Вкладка одного файла. */
export function App({ initialSplit = DEFAULT_SPLIT }: { initialSplit?: number }) {
  const [data, setData] = useState<DiffData>();
  const [status, setStatus] = useState<Status>({ state: 'loading', cancel: () => {} });
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<DiffMode>('ribbons');
  const [wholeFile, setWholeFile] = useState(false);
  const [fragmentOnly, setFragmentOnly] = useState(false);
  const [split, setSplit] = useState(initialSplit);
  const [summary, setSummary] = useState<DiffSummary>();
  const [current, setCurrent] = useState<number>();
  const diff = useRef<DiffController>(null);
  const theme = useThemeKind();

  const load = useCallback(() => {
    const req = bridge.requestLatest('load', {});
    setStatus({ state: 'loading', cancel: req.cancel });
    req.promise.then(
      (result) => {
        // История по строкам: по умолчанию только выделенные строки; если снять флажок —
        // весь файл без сворачивания, фрагмент подсвечен.
        setData((previous) => {
          if (result.fragment && !previous?.fragment) {
            setFragmentOnly(true);
            setWholeFile(true);
          }
          return result;
        });
        setCurrent(undefined);
        setStatus({ state: 'ready' });
      },
      (error: Error) =>
        setStatus(
          error instanceof CancelledError
            ? { state: 'cancelled' }
            : { state: 'error', message: error.message },
        ),
    );
  }, []);

  useEffect(() => {
    const off = bridge.onEvent((event) => {
      if (event.type === 'reload') load();
    });
    load();
    return off;
  }, [load]);

  // F7 / Shift+F7 — следующее / предыдущее изменение, как в WebStorm.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F7' || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      diff.current?.navigate(event.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = async (side: SideName) => {
    setPicking(true);
    try {
      const { changed } = await bridge.request('pickRef', { side }).promise;
      if (changed) load();
    } catch (error) {
      setStatus({ state: 'error', message: (error as Error).message });
    } finally {
      setPicking(false);
    }
  };

  const swap = async () => {
    await bridge.request('swap', {}).promise;
    load();
  };

  const reason = data && unviewableReason(data);
  const showDiff = data && !reason;
  const count = summary?.chunks ?? 0;
  const fragment = data?.fragment;
  const sliced = showDiff && fragment && fragmentOnly;
  const textA = data ? sideText(data.left.content) : '';
  const textB = data ? sideText(data.right.content) : '';

  return (
    <div className="app">
      <Toolbar
        title={
          <>
            {data?.path}
            {showDiff && summary && <DiffStats added={summary.added} removed={summary.removed} />}
          </>
        }
      >
        {fragment && (
          <label className="checkbox" title="Дифф только выделенных строк — в обеих версиях">
            <input
              type="checkbox"
              checked={fragmentOnly}
              onChange={(e) => setFragmentOnly(e.target.checked)}
            />
            Только выделенные строки
          </label>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={wholeFile}
            onChange={(e) => setWholeFile(e.target.checked)}
          />
          Весь файл
        </label>
        <div className="segmented" role="group" aria-label="Вид">
          {MODES.map(([value, label, title]) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              title={title}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="nav" role="group" aria-label="Изменения">
          <button
            onClick={() => diff.current?.navigate(-1)}
            disabled={!showDiff || !count}
            title="Предыдущее изменение (Shift+F7)"
          >
            ↑
          </button>
          <span className="nav__counter">
            {!showDiff
              ? ''
              : count
                ? `${current === undefined ? '–' : current + 1} / ${count}`
                : 'нет изменений'}
          </span>
          <button
            onClick={() => diff.current?.navigate(1)}
            disabled={!showDiff || !count}
            title="Следующее изменение (F7)"
          >
            ↓
          </button>
        </div>
      </Toolbar>
      <RevisionBar
        split={mode === 'unified' ? DEFAULT_SPLIT : split}
        left={data?.left}
        right={data?.right}
        disabled={picking || status.state === 'loading'}
        onPick={pick}
        onSwap={swap}
      />
      <div className="app__diff">
        {showDiff && (
          <DiffView
            a={sliced ? sliceLines(textA, fragment.left) : textA}
            b={sliced ? sliceLines(textB, fragment.right) : textB}
            lineOffset={
              sliced ? { a: fragment.left.from - 1, b: fragment.right.from - 1 } : undefined
            }
            fragment={fragment && !sliced ? { a: fragment.left, b: fragment.right } : undefined}
            split={split}
            onSplitChange={(ratio) => {
              setSplit(ratio);
              void bridge.request('saveLayout', { split: ratio }).promise.catch(() => {});
            }}
            path={data.path}
            mode={mode}
            dark={theme === 'dark' || theme === 'high-contrast'}
            wholeFile={wholeFile}
            controller={diff}
            onSummary={setSummary}
            onCurrentChunk={setCurrent}
          />
        )}
        {reason && <Placeholder>{reason}</Placeholder>}
        {status.state === 'cancelled' && (
          <Placeholder>
            Загрузка отменена. <button onClick={load}>Повторить</button>
          </Placeholder>
        )}
        {status.state === 'error' && (
          <Placeholder>
            <span className="error">{status.message}</span>{' '}
            <button onClick={load}>Повторить</button>
          </Placeholder>
        )}
        {status.state === 'loading' && <Loader onCancel={status.cancel} />}
      </div>
    </div>
  );
}

/** Строки `range` (с 1, включительно) текста; пустой диапазон — пустой текст. */
function sliceLines(text: string, range: { from: number; to: number }): string {
  if (range.to < range.from) return '';
  return text
    .split(/\r\n|\r|\n/)
    .slice(range.from - 1, range.to)
    .join('\n');
}
