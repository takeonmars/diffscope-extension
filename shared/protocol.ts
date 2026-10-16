// Типы сообщений между вкладкой диффа (webview) и расширением. Общие для обеих сторон.

/** Запросы вкладки: тип → параметры и результат. */
export interface RequestMap {
  /** Проверка связи. */
  ping: { params: { text: string }; result: { text: string; at: string } };
  /** Долгая операция для проверки индикатора загрузки и отмены. */
  wait: { params: { ms: number }; result: { waited: number } };
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
