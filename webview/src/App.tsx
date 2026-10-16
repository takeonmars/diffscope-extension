import { useEffect, useState } from 'react';
import { CancelledError } from './bridge';
import { Loader } from './components/Loader/Loader';
import { Toolbar } from './components/Toolbar/Toolbar';
import { useThemeKind } from './theme/useThemeKind';
import { bridge } from './vscodeApi';

type Status =
  | { state: 'idle' }
  | { state: 'loading'; cancel(): void }
  | { state: 'done'; text: string }
  | { state: 'error'; text: string };

export function App() {
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('проверка…');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const theme = useThemeKind();

  useEffect(() => {
    const off = bridge.onEvent((event) => {
      if (event.type === 'init') setTitle(event.title);
    });
    bridge.ready();
    const started = performance.now();
    bridge
      .request('ping', { text: 'привет' })
      .promise.then(() => setLink(`есть, ответ за ${Math.round(performance.now() - started)} мс`))
      .catch((error: Error) => setLink(`ошибка: ${error.message}`));
    return off;
  }, []);

  const runLong = () => {
    const req = bridge.requestLatest('wait', { ms: 5000 });
    setStatus({ state: 'loading', cancel: req.cancel });
    req.promise
      .then(({ waited }) => setStatus({ state: 'done', text: `Готово за ${waited} мс` }))
      .catch((error: Error) =>
        setStatus(
          error instanceof CancelledError
            ? { state: 'done', text: 'Отменено' }
            : { state: 'error', text: error.message },
        ),
      );
  };

  return (
    <div className="app">
      <Toolbar title={title} />
      <main className="app__body">
        <p>Связь с расширением: {link}</p>
        <p>Тема: {theme}</p>
        <p>
          <button onClick={runLong} disabled={status.state === 'loading'}>
            Долгая операция (5 с)
          </button>{' '}
          {(status.state === 'done' || status.state === 'error') && (
            <span className={status.state === 'error' ? 'error' : undefined}>{status.text}</span>
          )}
        </p>
        {status.state === 'loading' && <Loader onCancel={status.cancel} />}
      </main>
    </div>
  );
}
