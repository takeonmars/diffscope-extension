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
  /** Доля ширины левой колонки, 0.15–0.85. */
  split: number;
}

export type ExtensionEvent =
  | { type: 'init'; title: string; layout?: Layout }
  /** Вкладка показывает другой файл или другие ревизии — загрузить заново. */
  | { type: 'reload' };

export type ExtensionToWebview =
  | { kind: 'result'; id: number; result: unknown }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'event'; event: ExtensionEvent };
