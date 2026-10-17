// Корень вкладки: ждёт от расширения init и рисует вкладку одного файла или «все файлы»
// сравнения веток; раскладка (ширина колонок) приходит в init.
import { useEffect, useState } from 'react';
import type { ExtensionEvent } from '../../shared/protocol';
import { App } from './App';
import { LogApp } from './log/LogApp';
import { MultiApp } from './MultiApp';
import { bridge } from './vscodeApi';

type Init = Extract<ExtensionEvent, { type: 'init' }>;

export function Root() {
  const [init, setInit] = useState<Init>();

  useEffect(() => {
    const off = bridge.onEvent((event) => {
      if (event.type === 'init') setInit(event);
    });
    bridge.ready();
    return off;
  }, []);

  if (!init) return null;
  const split = init.layout?.split;
  if (init.view === 'log') return <LogApp layout={init.layout} />;
  return init.view === 'multi' ? <MultiApp initialSplit={split} /> : <App initialSplit={split} />;
}
