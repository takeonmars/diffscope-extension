// Заглушка расширения для vite dev в браузере: отвечает на запросы вкладки тестовыми примерами.
// «Выбор ревизии» переключает пример по кругу. В сборку для VS Code не попадает.
import type { DiffData, ExtensionToWebview, WebviewToExtension } from '../../../shared/protocol';
import { samples } from './samples';

export function browserStub(deliver: (message: ExtensionToWebview) => void) {
  let index = 0;
  let swapped = false;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const reply = (id: number, result: unknown, delay = 0) =>
    timers.set(
      id,
      setTimeout(() => deliver({ kind: 'result', id, result }), delay),
    );

  const data = (): DiffData => {
    const s = samples[index];
    const left = {
      label: 'HEAD',
      description: s.name,
      content: { kind: 'text' as const, text: s.a },
    };
    const right = {
      label: 'Рабочая копия',
      description: 'текущее состояние файла',
      content: { kind: 'text' as const, text: s.b },
    };
    const fragment =
      s.fragment && (swapped ? { left: s.fragment.right, right: s.fragment.left } : s.fragment);
    return {
      path: 'src/example.ts',
      ...(swapped ? { left: right, right: left } : { left, right }),
      fragment,
    };
  };

  return {
    postMessage(message: WebviewToExtension) {
      if (message.kind === 'ready') {
        deliver({ kind: 'event', event: { type: 'init', title: 'DiffScope (браузер)' } });
      } else if (message.kind === 'cancel') {
        clearTimeout(timers.get(message.id));
      } else if (message.type === 'load') {
        reply(message.id, data(), 300);
      } else if (message.type === 'pickRef') {
        index = (index + 1) % samples.length;
        reply(message.id, { changed: true });
      } else if (message.type === 'saveLayout') {
        reply(message.id, null);
      } else if (message.type === 'swap') {
        swapped = !swapped;
        reply(message.id, null);
      }
    },
  };
}
