// Заглушка расширения для vite dev в браузере: отвечает на запросы вкладки тестовыми примерами.
// «Выбор ревизии» переключает пример по кругу. В сборку для VS Code не попадает.
import type {
  DiffData,
  ExtensionToWebview,
  MultiData,
  WebviewToExtension,
} from '../../../shared/protocol';
import { samples } from './samples';

/** Вкладка «все файлы»: каждый пример — файл сравнения, плюс несколько копий небольшого. */
const multiSamples = [samples[0], samples[1], samples[3], samples[0], samples[0], samples[2]];

function multiData(): MultiData {
  const lineCount = (t: string) => t.split('\n').length;
  return {
    title: 'main...feature',
    left: { label: 'main', description: 'общий предок с feature: a1b2c3d' },
    right: { label: 'feature', description: 'Фича' },
    files: multiSamples.map((sample, i) => ({
      path: [
        'src/config.ts',
        'src/big/generated.ts',
        'src/history.ts',
        'lib/a.ts',
        'lib/b.ts',
        'README.md',
      ][i],
      status: i === 3 ? 'renamed' : 'modified',
      oldPath: i === 3 ? 'lib/old-a.ts' : undefined,
      added: Math.max(1, lineCount(sample.b) - lineCount(sample.a) + 5),
      removed: 3,
    })),
  };
}

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
        // ?view=multi — вкладка «все файлы» сравнения веток.
        const view =
          new URLSearchParams(location.search).get('view') === 'multi' ? 'multi' : 'single';
        deliver({ kind: 'event', event: { type: 'init', title: 'DiffScope (браузер)', view } });
      } else if (message.kind === 'cancel') {
        clearTimeout(timers.get(message.id));
      } else if (message.type === 'load') {
        reply(message.id, data(), 300);
      } else if (message.type === 'pickRef') {
        index = (index + 1) % samples.length;
        reply(message.id, { changed: true });
      } else if (message.type === 'multiList') {
        reply(message.id, multiData(), 200);
      } else if (message.type === 'multiFile') {
        const sample = multiSamples[message.params.index];
        const side = (label: string, text: string) => ({
          label,
          content: { kind: 'text' as const, text },
        });
        reply(message.id, { left: side('main', sample.a), right: side('feature', sample.b) }, 150);
      } else if (message.type === 'openFile') {
        reply(message.id, null);
      } else if (message.type === 'saveLayout') {
        reply(message.id, null);
      } else if (message.type === 'swap') {
        swapped = !swapped;
        reply(message.id, null);
      }
    },
  };
}
