// Подсветка синтаксиса по расширению файла. Языковые пакеты загружаются по требованию —
// отдельными частями сборки; неизвестный язык — простой текст.
import type { Extension } from '@codemirror/state';

type Loader = () => Promise<Extension>;

const js =
  (typescript: boolean, jsx: boolean): Loader =>
  async () =>
    (await import('@codemirror/lang-javascript')).javascript({ typescript, jsx });

const LANGUAGES: Record<string, Loader> = {
  ts: js(true, false),
  mts: js(true, false),
  cts: js(true, false),
  tsx: js(true, true),
  js: js(false, false),
  mjs: js(false, false),
  cjs: js(false, false),
  jsx: js(false, true),
  json: async () => (await import('@codemirror/lang-json')).json(),
  jsonc: async () => (await import('@codemirror/lang-json')).json(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  scss: async () => (await import('@codemirror/lang-css')).css(),
  less: async () => (await import('@codemirror/lang-css')).css(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  htm: async () => (await import('@codemirror/lang-html')).html(),
  vue: async () => (await import('@codemirror/lang-html')).html(),
  md: async () => (await import('@codemirror/lang-markdown')).markdown(),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  yml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  py: async () => (await import('@codemirror/lang-python')).python(),
  go: async () => (await import('@codemirror/lang-go')).go(),
};

export async function languageFor(path: string): Promise<Extension> {
  const name = path.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const load = LANGUAGES[ext];
  if (!load) return [];
  try {
    return await load();
  } catch {
    return []; // часть сборки не загрузилась — показываем без подсветки
  }
}
