// Вкладка «все файлы» сравнения веток: сплошная прокрутка, файлы друг за другом, у каждого —
// заголовок и дифф с лентами. Клик в дереве панели прокручивает к файлу (событие reveal).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MultiData } from '../../shared/protocol';
import { CancelledError } from './bridge';
import { DiffStats } from './components/DiffStats/DiffStats';
import { FileSection } from './components/FileSection/FileSection';
import { Loader } from './components/Loader/Loader';
import { Placeholder } from './components/Placeholder/Placeholder';
import { RevisionBar } from './components/RevisionBar/RevisionBar';
import { Toolbar } from './components/Toolbar/Toolbar';
import { DEFAULT_SPLIT } from './diff/splitter';
import { useThemeKind } from './theme/useThemeKind';
import { bridge } from './vscodeApi';

export function MultiApp({ initialSplit = DEFAULT_SPLIT }: { initialSplit?: number }) {
  const [data, setData] = useState<MultiData>();
  const [loading, setLoading] = useState<{ cancel(): void }>();
  const [error, setError] = useState<string>();
  const [split, setSplit] = useState(initialSplit);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  /** reveal пришёл раньше списка — прокрутить после отрисовки. */
  const pendingReveal = useRef<number | undefined>(undefined);
  const theme = useThemeKind();

  const load = useCallback(() => {
    const req = bridge.requestLatest('multiList', {});
    setLoading({ cancel: req.cancel });
    setError(undefined);
    req.promise.then(
      (result) => {
        setData(result);
        setLoading(undefined);
      },
      (e: Error) => {
        // Отменён новым запросом списка (повторная загрузка) — ответит следующий.
        if (e instanceof CancelledError) return;
        setLoading(undefined);
        setError(e.message);
      },
    );
  }, []);

  const reveal = useCallback((index: number) => {
    const node = document.getElementById(`file-${index}`);
    if (!node) {
      pendingReveal.current = index;
      return;
    }
    node.scrollIntoView({ block: 'start' });
  }, []);

  useEffect(() => {
    const off = bridge.onEvent((event) => {
      if (event.type === 'reload') load();
      if (event.type === 'reveal') reveal(event.index);
    });
    load();
    return off;
  }, [load, reveal]);

  useEffect(() => {
    if (data && pendingReveal.current !== undefined) {
      const index = pendingReveal.current;
      pendingReveal.current = undefined;
      requestAnimationFrame(() => reveal(index));
    }
  }, [data, reveal]);

  const onSplitChange = useCallback((ratio: number) => {
    setSplit(ratio);
    void bridge.request('saveLayout', { split: ratio }).promise.catch(() => {});
  }, []);

  const totals = data?.files.reduce(
    (t, f) => ({ added: t.added + (f.added ?? 0), removed: t.removed + (f.removed ?? 0) }),
    { added: 0, removed: 0 },
  );
  const dark = theme === 'dark' || theme === 'high-contrast';

  return (
    <div className="app">
      <Toolbar
        title={
          <>
            {data ? `${data.title} · ${filesText(data.files.length)}` : ''}
            {totals && <DiffStats added={totals.added} removed={totals.removed} />}
          </>
        }
      />
      <RevisionBar
        split={split}
        left={data && { ...data.left, content: { kind: 'text', text: '' } }}
        right={data && { ...data.right, content: { kind: 'text', text: '' } }}
        disabled
        onPick={() => {}}
        onSwap={() => {}}
      />
      <div className="app__diff">
        <div className="multi" ref={setScroller}>
          {data?.note && <div className="multi__note">{data.note}</div>}
          {data?.files.map((file, index) => (
            <FileSection
              key={`${data.title}:${file.path}`}
              index={index}
              file={file}
              scroller={scroller}
              dark={dark}
              split={split}
              onSplitChange={onSplitChange}
            />
          ))}
          {data && !data.files.length && <Placeholder>Различий нет.</Placeholder>}
        </div>
        {error && (
          <Placeholder>
            <span className="error">{error}</span> <button onClick={load}>Повторить</button>
          </Placeholder>
        )}
        {loading && <Loader onCancel={loading.cancel} />}
      </div>
    </div>
  );
}

function filesText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'файл'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'файла'
        : 'файлов';
  return `${n} ${word}`;
}
