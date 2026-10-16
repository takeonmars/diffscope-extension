// Разбор запросов вкладки: вызов обработчика по типу, ответ с тем же id, отмена через AbortSignal.
// Не зависит от vscode — тестируется отдельно.
import type {
  ExtensionToWebview,
  Params,
  RequestType,
  Result,
  WebviewToExtension,
} from '../../shared/protocol';

export type Handlers = {
  [T in RequestType]: (params: Params<T>, signal: AbortSignal) => Promise<Result<T>>;
};

export class MessageRouter {
  private readonly running = new Map<number, AbortController>();

  constructor(
    private readonly handlers: Handlers,
    private readonly post: (message: ExtensionToWebview) => void,
    private readonly onReady: () => void = () => {},
  ) {}

  handle(message: WebviewToExtension): void {
    switch (message.kind) {
      case 'ready':
        this.onReady();
        return;
      case 'cancel':
        this.running.get(message.id)?.abort();
        this.running.delete(message.id);
        return;
      case 'request':
        void this.run(message.id, message.type, message.params);
        return;
    }
  }

  /** Отменяет все выполняющиеся запросы — при закрытии вкладки. */
  dispose(): void {
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
  }

  private async run<T extends RequestType>(id: number, type: T, params: Params<T>): Promise<void> {
    const handler = this.handlers[type] as Handlers[T] | undefined;
    if (!handler) {
      this.post({ kind: 'error', id, message: `Неизвестный запрос: ${String(type)}` });
      return;
    }
    const controller = new AbortController();
    this.running.set(id, controller);
    try {
      const result = await handler(params, controller.signal);
      if (!controller.signal.aborted) this.post({ kind: 'result', id, result });
    } catch (error) {
      // Отменённый запрос вкладка уже забыла — отвечать некому.
      if (!controller.signal.aborted) {
        this.post({
          kind: 'error',
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      this.running.delete(id);
    }
  }
}
