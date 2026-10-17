// Дифф файла коммита во всплывающем окне Git Log: «родитель → коммит», те же режимы, что во
// вкладке диффа (Ленты / MergeView / 1 колонка), «Весь файл», навигация F7 и сводка; справа на
// панели — кнопки окна (actions).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DiffSide } from '../../../shared/protocol';
import { CancelledError } from '../bridge';
import { DiffStats } from '../components/DiffStats/DiffStats';
import {
  DiffView,
  type DiffController,
  type DiffMode,
  type DiffSummary,
} from '../components/DiffView/DiffView';
import { Loader } from '../components/Loader/Loader';
import { sideText, unviewableReason } from '../components/Placeholder/Placeholder';
import { useThemeKind } from '../theme/useThemeKind';
import { bridge } from '../vscodeApi';

const MODES: [DiffMode, string][] = [
  ['ribbons', 'Ленты'],
  ['aligned', 'MergeView'],
  ['unified', '1 колонка'],
];

interface Props {
  hash: string;
  index: number;
  path: string;
  split: number;
  onSplitChange(ratio: number): void;
  /** Кнопки в конце панели инструментов (соседние файлы, закрыть). */
  actions?: ReactNode;
}

export function DiffPane({ hash, index, path, split, onSplitChange, actions }: Props) {
  const [sides, setSides] = useState<{ left: DiffSide; right: DiffSide }>();
  const [error, setError] = useState<string>();
  const [mode, setMode] = useState<DiffMode>('ribbons');
  const [wholeFile, setWholeFile] = useState(false);
  const [summary, setSummary] = useState<DiffSummary>();
  const [current, setCurrent] = useState<number>();
  const diff = useRef<DiffController>(null);
  const theme = useThemeKind();

  useEffect(() => {
    setSides(undefined);
    setError(undefined);
    setCurrent(undefined);
    // Новый файл отменяет загрузку прежнего (быстрые ↑/↓ по коммитам или файлам).
    const req = bridge.requestLatest('logFileDiff', { hash, index });
    req.promise.then(setSides, (e: Error) => {
      if (!(e instanceof CancelledError)) setError(e.message);
    });
    return req.cancel;
  }, [hash, index]);

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

  const reason = sides && unviewableReason({ path, left: sides.left, right: sides.right });
  const count = summary?.chunks ?? 0;

  return (
    <div className="log-diff">
      <div className="log-diff__toolbar">
        <span className="log-diff__path" title={path}>
          {path}
        </span>
        {sides && !reason && summary && (
          <DiffStats added={summary.added} removed={summary.removed} />
        )}
        <span className="log-diff__actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={wholeFile}
              onChange={(e) => setWholeFile(e.target.checked)}
            />
            Весь файл
          </label>
          <span className="segmented" role="group" aria-label="Вид">
            {MODES.map(([value, label]) => (
              <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
                {label}
              </button>
            ))}
          </span>
          <span className="nav">
            <button onClick={() => diff.current?.navigate(-1)} disabled={!count} title="Shift+F7">
              ↑
            </button>
            <span className="nav__counter">
              {count ? `${current === undefined ? '–' : current + 1} / ${count}` : ''}
            </span>
            <button onClick={() => diff.current?.navigate(1)} disabled={!count} title="F7">
              ↓
            </button>
          </span>
          {actions}
        </span>
      </div>
      <div className="app__diff">
        {sides && !reason && (
          <DiffView
            a={sideText(sides.left.content)}
            b={sideText(sides.right.content)}
            path={path}
            mode={mode}
            dark={theme === 'dark' || theme === 'high-contrast'}
            wholeFile={wholeFile}
            split={split}
            onSplitChange={onSplitChange}
            controller={diff}
            onSummary={setSummary}
            onCurrentChunk={setCurrent}
          />
        )}
        {reason && <div className="log-files__note">{reason}</div>}
        {error && <div className="log-files__note error">{error}</div>}
        {!sides && !error && <Loader />}
      </div>
    </div>
  );
}
