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

export interface DiffData {
  /** Путь файла в репозитории. */
  path: string;
  left: DiffSide;
  right: DiffSide;
}

/** Запросы вкладки: тип → параметры и результат. */
export interface RequestMap {
  /** Содержимое обеих сторон для текущих ревизий. */
  load: { params: Record<string, never>; result: DiffData };
  /** Выбрать ревизию стороны в выпадающем списке VS Code; changed — выбор сделан. */
  pickRef: { params: { side: SideName }; result: { changed: boolean } };
  /** Поменять стороны местами. */
  swap: { params: Record<string, never>; result: null };
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
export type ExtensionEvent = { type: 'init'; title: string };

export type ExtensionToWebview =
  | { kind: 'result'; id: number; result: unknown }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'event'; event: ExtensionEvent };
