import { useEffect, useRef, useState } from 'react';
import { DiffView, type DiffController, type DiffStats } from './components/DiffView/DiffView';
import { Toolbar } from './components/Toolbar/Toolbar';
import { samples } from './prototype/samples';
import { useThemeKind } from './theme/useThemeKind';
import { bridge } from './vscodeApi';

// Этап 1: прототип лент на тестовых данных. Ревизии из git появятся на этапе 3.
export function App() {
  const [title, setTitle] = useState('');
  const [sampleIndex, setSampleIndex] = useState(0);
  const [wholeFile, setWholeFile] = useState(false);
  const [stats, setStats] = useState<DiffStats>();
  const [current, setCurrent] = useState<number>();
  const diff = useRef<DiffController>(null);
  const theme = useThemeKind();
  const sample = samples[sampleIndex];

  useEffect(() => {
    const off = bridge.onEvent((event) => {
      if (event.type === 'init') setTitle(event.title);
    });
    bridge.ready();
    return off;
  }, []);

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

  const total = stats?.chunks ?? 0;

  return (
    <div className="app">
      <Toolbar title={title}>
        <select
          value={sampleIndex}
          onChange={(e) => setSampleIndex(Number(e.target.value))}
          aria-label="Пример"
        >
          {samples.map((s, i) => (
            <option key={s.name} value={i}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={wholeFile}
            onChange={(e) => setWholeFile(e.target.checked)}
          />
          Весь файл
        </label>
        <div className="nav" role="group" aria-label="Изменения">
          <button
            onClick={() => diff.current?.navigate(-1)}
            disabled={!total}
            title="Предыдущее изменение (Shift+F7)"
          >
            ↑
          </button>
          <span className="nav__counter">
            {total ? `${current === undefined ? '–' : current + 1} / ${total}` : 'нет изменений'}
          </span>
          <button
            onClick={() => diff.current?.navigate(1)}
            disabled={!total}
            title="Следующее изменение (F7)"
          >
            ↓
          </button>
        </div>
        {stats && (
          <span className="toolbar__stats">
            дифф {Math.round(stats.diffTime)} мс · всего {Math.round(stats.renderTime)} мс
          </span>
        )}
      </Toolbar>
      <DiffView
        a={sample.a}
        b={sample.b}
        dark={theme === 'dark' || theme === 'high-contrast'}
        wholeFile={wholeFile}
        controller={diff}
        onStats={setStats}
        onCurrentChunk={setCurrent}
      />
    </div>
  );
}
