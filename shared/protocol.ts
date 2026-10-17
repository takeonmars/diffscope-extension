// Типы сообщений между вкладкой диффа (webview) и расширением. Общие для обеих сторон.

export type SideName = 'left' | 'right';

/** Содержимое одной стороны диффа. */
export type SideContent =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; size: number }
  | { kind: 'tooLarge'; size: number }
  /** Файла нет на этой ревизии. */
  | { kind: 'missing' };

export interface DiffSide {
  /** Ревизия коротко: «HEAD», «main», «a1b2c3d», «Рабочая копия». */
  label: string;
  /** Подсказка: сообщение коммита, ветка. */
  description?: string;
  /** Путь файла на этой стороне, если он не такой, как у вкладки (файл переименован). */
  path?: string;
  content: SideContent;
}

/** Строки с 1, включительно; пустой диапазон — `to = from - 1` (место между строками). */
export interface LineRange {
  from: number;
  to: number;
}

export interface DiffData {
  /** Путь файла в репозитории. */
  path: string;
  left: DiffSide;
  right: DiffSide;
  /** История по строкам: фрагмент в обеих версиях — подсвечивается, к нему прокручивается дифф. */
  fragment?: { left: LineRange; right: LineRange };
}

/** Файл во вкладке «все файлы» сравнения веток. */
export interface MultiFile {
  path: string;
  /** Путь слева, если файл переименован. */
  oldPath?: string;
  /** added / modified / deleted / renamed / copied / typeChanged / unmerged / unknown. */
  status: string;
  added?: number;
  removed?: number;
  binary?: boolean;
}

export interface MultiData {
  /** «main...feature». */
  title: string;
  left: { label: string; description?: string };
  right: { label: string; description?: string };
  files: MultiFile[];
  /** У веток нет общей истории — показано прямое сравнение. */
  noMergeBase?: boolean;
}

/** Окно Git Log: ветка, удалённая ветка или тег. */
export interface LogRef {
  /** main, origin/main, v1. */
  name: string;
  /** refs/heads/main — для фильтра коммитов. */
  fullName: string;
}

export interface LogRefs {
  /** Имя папки репозитория. */
  repo: string;
  head?: { branch?: string; commit?: string };
  branches: LogRef[];
  remotes: LogRef[];
  tags: LogRef[];
}

/** Коммит в окне Git Log. */
export interface LogCommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  /** мс с 1970 года. */
  date: number;
  subject: string;
  /** Метки у коммита: ветки, удалённые ветки, теги, HEAD. */
  refs: { kind: 'head' | 'branch' | 'remote' | 'tag'; name: string; current?: boolean }[];
}

/** Запросы вкладки: тип → параметры и результат. */
export interface RequestMap {
  /** Содержимое обеих сторон для текущих ревизий. */
  load: { params: Record<string, never>; result: DiffData };
  /** Выбрать ревизию стороны в выпадающем списке VS Code; changed — выбор сделан. */
  pickRef: { params: { side: SideName }; result: { changed: boolean } };
  /** Поменять стороны местами. */
  swap: { params: Record<string, never>; result: null };
  /** Запомнить раскладку для всех вкладок: доля ширины левой колонки. */
  saveLayout: { params: Layout; result: null };
  /** Вкладка «все файлы»: список файлов сравнения. */
  multiList: { params: Record<string, never>; result: MultiData };
  /** Вкладка «все файлы»: содержимое обеих сторон файла (по номеру в списке). */
  multiFile: { params: { index: number }; result: { left: DiffSide; right: DiffSide } };
  /** Вкладка «все файлы»: открыть файл в отдельной вкладке. */
  openFile: { params: { index: number }; result: null };
  /** Окно Git Log: ветки и теги; null — нет репозитория. */
  logRefs: { params: Record<string, never>; result: LogRefs | null };
  /** Окно Git Log: порция коммитов (ref не задан — все ветки) в порядке --topo-order. */
  logCommits: {
    params: { ref?: string; skip: number };
    result: { commits: LogCommitInfo[]; hasMore: boolean };
  };
  /** Окно Git Log: файлы коммита (против первого родителя; у корневого — против пустого). */
  logCommitFiles: {
    params: { hash: string };
    /** message — сообщение коммита целиком (заголовок и тело). */
    result: { files: MultiFile[]; message: string };
  };
  /** Окно Git Log: обе стороны файла коммита (по номеру в списке файлов). */
  logFileDiff: {
    params: { hash: string; index: number };
    result: { left: DiffSide; right: DiffSide };
  };
}

export type RequestType = keyof RequestMap;
export type Params<T extends RequestType> = RequestMap[T]['params'];
export type Result<T extends RequestType> = RequestMap[T]['result'];

export type RequestMessage = {
  [T in RequestType]: { kind: 'request'; id: number; type: T; params: Params<T> };
}[RequestType];

export type WebviewToExtension =
  | RequestMessage
  | { kind: 'cancel'; id: number }
  /** Вкладка загрузилась и готова принимать события. */
  | { kind: 'ready' };

/** События расширения без запроса. */
/** Раскладка вкладки, общая для всех вкладок. */
export interface Layout {
  /** Доля ширины левой колонки диффа, 0.15–0.85. */
  split?: number;
  /** Окно Git Log: ширина колонки веток и колонки деталей, px. */
  logLeft?: number;
  logRight?: number;
}

export type ExtensionEvent =
  /** view — какая вкладка: один файл или все файлы сравнения. */
  | { type: 'init'; title: string; layout?: Layout; view?: 'single' | 'multi' | 'log' }
  /** Окно Git Log: перечитать ветки и коммиты (кнопка ⟳, смена ветки, новый коммит). */
  | { type: 'logRefresh' }
  /** Вкладка «все файлы»: прокрутить к файлу (клик в дереве). */
  | { type: 'reveal'; index: number }
  /** Вкладка показывает другой файл или другие ревизии — загрузить заново. */
  | { type: 'reload' };

export type ExtensionToWebview =
  | { kind: 'result'; id: number; result: unknown }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'event'; event: ExtensionEvent };
