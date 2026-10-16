// Мост вкладки: запросы к расширению с id, ожидание ответов, отмена.
// Ядро (createBridge) не зависит от DOM — тестируется отдельно.
import type {
  ExtensionEvent,
  ExtensionToWebview,
  Params,
  RequestType,
  Result,
  WebviewToExtension,
} from '../../shared/protocol';

export class CancelledError extends Error {
  constructor() {
    super('Отменено');
    this.name = 'CancelledError';
  }
}

export interface PendingRequest<T> {
  promise: Promise<T>;
  cancel(): void;
}

export interface Bridge {
  request<T extends RequestType>(type: T, params: Params<T>): PendingRequest<Result<T>>;
  /** Как request, но сначала отменяет предыдущий незавершённый запрос того же типа. */
  requestLatest<T extends RequestType>(type: T, params: Params<T>): PendingRequest<Result<T>>;
  onEvent(listener: (event: ExtensionEvent) => void): () => void;
  /** Передать сообщение от расширения. */
  receive(message: ExtensionToWebview): void;
  ready(): void;
}

export function createBridge(post: (message: WebviewToExtension) => void): Bridge {
  let nextId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const latest = new Map<RequestType, () => void>();
  const listeners = new Set<(event: ExtensionEvent) => void>();

  function request<T extends RequestType>(type: T, params: Params<T>): PendingRequest<Result<T>> {
    const id = nextId++;
    const promise = new Promise<Result<T>>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    post({ kind: 'request', id, type, params } as WebviewToExtension);
    const cancel = () => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      post({ kind: 'cancel', id });
      entry.reject(new CancelledError());
    };
    return { promise, cancel };
  }

  return {
    request,
    requestLatest(type, params) {
      latest.get(type)?.();
      const req = request(type, params);
      latest.set(type, req.cancel);
      const forget = () => {
        if (latest.get(type) === req.cancel) latest.delete(type);
      };
      req.promise.then(forget, forget);
      return req;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    receive(message) {
      if (message.kind === 'event') {
        for (const listener of listeners) listener(message.event);
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return; // ответ на отменённый запрос
      pending.delete(message.id);
      if (message.kind === 'result') entry.resolve(message.result);
      else entry.reject(new Error(message.message));
    },
    ready() {
      post({ kind: 'ready' });
    },
  };
}
