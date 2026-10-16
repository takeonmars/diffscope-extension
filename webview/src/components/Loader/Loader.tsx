// Индикатор загрузки поверх области; кнопка «Отменить» появляется, если операция идёт дольше 1 с.
import { useEffect, useState } from 'react';

const CANCEL_DELAY_MS = 1000;

export function Loader({ onCancel }: { onCancel?: () => void }) {
  const [showCancel, setShowCancel] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowCancel(true), CANCEL_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="loader" role="status" aria-live="polite">
      <div className="loader__bar" />
      <span>Загрузка…</span>
      {showCancel && onCancel && <button onClick={onCancel}>Отменить</button>}
    </div>
  );
}
