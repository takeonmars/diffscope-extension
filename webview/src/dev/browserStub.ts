// Заглушка расширения для vite dev в браузере: отвечает на запросы вкладки тестовыми примерами.
// «Выбор ревизии» переключает пример по кругу. В сборку для VS Code не попадает.
import type {
  DiffData,
  ExtensionToWebview,
  MultiData,
  WebviewToExtension,
} from '../../../shared/protocol';
import { samples } from './samples';

const logRefs = {
  repo: 'diffscope-extension',
  head: { branch: 'main', commit: 'c0' },
  branches: ['main', 'feature/ribbons', 'feature/log', 'fix/merge'].map((name) => ({
    name,
    fullName: `refs/heads/${name}`,
  })),
  remotes: ['origin/main', 'origin/feature/ribbons'].map((name) => ({
    name,
    fullName: `refs/remotes/${name}`,
  })),
  tags: ['v0.1.0', 'v0.2.0'].map((name) => ({ name, fullName: `refs/tags/${name}` })),
};

/**
 * История для графа: группы по 6 коммитов — merge ветки фичи (из двух коммитов) в main, всего
 * ~3000; фильтр по ветке — только main.
 */
function logCommits(ref?: string) {
  const authors = ['Егор', 'Анна', 'Борис'];
  const groups = 500;
  const id = (g: number, name: string) =>
    `${g.toString(16).padStart(6, '0')}${name.padEnd(2, '0')}${'0'.repeat(32)}`;
  type Item = { hash: string; parents: string[]; subject: string };
  const list: Item[] = [];
  for (let g = 0; g < groups; g++) {
    const next = g + 1 < groups ? [id(g + 1, 'm')] : [];
    list.push(
      {
        hash: id(g, 'm'),
        parents: [id(g, 'a'), id(g, 'f3')],
        subject: `Merge pull request #${groups - g} from me/feature/f${groups - g}`,
      },
      { hash: id(g, 'f3'), parents: [id(g, 'f2')], subject: `Фича ${groups - g}: тесты` },
      { hash: id(g, 'a'), parents: [id(g, 'b')], subject: `Правка в main ${groups - g}` },
      { hash: id(g, 'f2'), parents: [id(g, 'f1')], subject: `Фича ${groups - g}: ленты` },
      { hash: id(g, 'f1'), parents: [id(g, 'b')], subject: `Фича ${groups - g}: начало` },
      { hash: id(g, 'b'), parents: next, subject: `Релиз ${groups - g}` },
    );
  }
  const commits = list.map((c, i) => ({
    ...c,
    shortHash: c.hash.slice(0, 8),
    author: authors[i % 3],
    email: `${authors[i % 3]}@example.com`,
    date: Date.UTC(2026, 9, 16) - i * 3_600_000,
    refs: [] as { kind: 'head' | 'branch' | 'remote' | 'tag'; name: string; current?: boolean }[],
  }));
  commits[0].refs.push(
    { kind: 'branch', name: 'main', current: true },
    { kind: 'remote', name: 'origin/main' },
  );
  commits[1].refs.push({ kind: 'branch', name: 'feature/ribbons' });
  commits[5].refs.push({ kind: 'tag', name: 'v0.2.0' });
  if (!ref) return commits;
  const main = new Set<string>();
  for (let h: string | undefined = commits[0].hash; h;) {
    main.add(h);
    h = commits.find((c) => c.hash === h)?.parents[0];
    if (main.size > 600) break;
  }
  return commits.filter((c) => main.has(c.hash));
}

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
        // ?view=multi — вкладка «все файлы» сравнения веток; ?view=log — окно Git Log.
        const param = new URLSearchParams(location.search).get('view');
        const view = param === 'multi' || param === 'log' ? param : 'single';
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
      } else if (message.type === 'logRefs') {
        reply(message.id, logRefs, 100);
      } else if (message.type === 'logCommits') {
        const all = logCommits(message.params.ref);
        const page = all.slice(message.params.skip, message.params.skip + 500);
        reply(message.id, { commits: page, hasMore: message.params.skip + 500 < all.length }, 150);
      } else if (message.type === 'logCommitFiles') {
        reply(
          message.id,
          {
            files: multiData().files.slice(
              0,
              (parseInt(message.params.hash.slice(6, 8), 16) % 4) + 2,
            ),
            message:
              'Заголовок коммита\n\nТело сообщения: что и зачем поменяли.\n- пункт первый\n- пункт второй',
          },
          100,
        );
      } else if (message.type === 'logFileDiff') {
        const sample = multiSamples[message.params.index % multiSamples.length];
        const side = (label: string, text: string) => ({
          label,
          content: { kind: 'text' as const, text },
        });
        reply(
          message.id,
          { left: side('родитель', sample.a), right: side('коммит', sample.b) },
          120,
        );
      } else if (message.type === 'saveLayout') {
        reply(message.id, null);
      } else if (message.type === 'swap') {
        swapped = !swapped;
        reply(message.id, null);
      }
    },
  };
}
