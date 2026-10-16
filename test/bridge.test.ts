// Мост вкладки и маршрутизатор расширения, соединённые напрямую — без VS Code.
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionToWebview, WebviewToExtension } from '../shared/protocol';
import { createHandlers } from '../src/diffPanel/handlers';
import { MessageRouter, type Handlers } from '../src/diffPanel/messageRouter';
import { CancelledError, createBridge } from '../webview/src/bridge';

function connect(handlers: Handlers = createHandlers()) {
  const toExtension: WebviewToExtension[] = [];
  const toWebview: ExtensionToWebview[] = [];
  const onReady = vi.fn();
  // router объявлен ниже: мост вызывает его только при отправке, когда он уже создан.
  const bridge = createBridge((message) => {
    toExtension.push(message);
    router.handle(message);
  });
  const router = new MessageRouter(
    handlers,
    (message) => {
      toWebview.push(message);
      bridge.receive(message);
    },
    onReady,
  );
  return { bridge, router, toExtension, toWebview, onReady };
}

describe('мост и маршрутизатор', () => {
  it('отвечает на запрос с тем же id', async () => {
    const { bridge, toExtension, toWebview } = connect();
    const result = await bridge.request('ping', { text: 'привет' }).promise;
    expect(result.text).toBe('привет');
    expect(toExtension[0]).toMatchObject({ kind: 'request', id: 1, type: 'ping' });
    expect(toWebview[0]).toMatchObject({ kind: 'result', id: 1 });
  });

  it('передаёт ошибку обработчика', async () => {
    const { bridge } = connect({
      ...createHandlers(),
      ping: async () => {
        throw new Error('сломалось');
      },
    });
    await expect(bridge.request('ping', { text: '' }).promise).rejects.toThrow('сломалось');
  });

  it('отмена прерывает обработчик и не присылает ответ', async () => {
    let signal: AbortSignal | undefined;
    const { bridge, toExtension, toWebview } = connect({
      ...createHandlers(),
      wait: (_params, s) => {
        signal = s;
        return new Promise(() => {});
      },
    });
    const req = bridge.request('wait', { ms: 1000 });
    req.cancel();
    await expect(req.promise).rejects.toBeInstanceOf(CancelledError);
    expect(signal?.aborted).toBe(true);
    expect(toExtension.at(-1)).toEqual({ kind: 'cancel', id: 1 });
    expect(toWebview).toHaveLength(0);
  });

  it('requestLatest отменяет предыдущий запрос того же типа', async () => {
    vi.useFakeTimers();
    try {
      const { bridge } = connect();
      const first = bridge.requestLatest('wait', { ms: 100 });
      const second = bridge.requestLatest('wait', { ms: 50 });
      await expect(first.promise).rejects.toBeInstanceOf(CancelledError);
      await vi.advanceTimersByTimeAsync(50);
      await expect(second.promise).resolves.toEqual({ waited: 50 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('неизвестный тип запроса — ошибка', async () => {
    const { bridge } = connect({} as Handlers);
    await expect(bridge.request('ping', { text: '' }).promise).rejects.toThrow(
      'Неизвестный запрос',
    );
  });

  it('ready вызывает обработчик, события доходят до подписчиков', () => {
    const { bridge, onReady } = connect();
    const listener = vi.fn();
    bridge.onEvent(listener);
    bridge.ready();
    expect(onReady).toHaveBeenCalledOnce();
    bridge.receive({ kind: 'event', event: { type: 'init', title: 'X' } });
    expect(listener).toHaveBeenCalledWith({ type: 'init', title: 'X' });
  });

  it('dispose отменяет выполняющиеся запросы', () => {
    let signal: AbortSignal | undefined;
    const { bridge, router } = connect({
      ...createHandlers(),
      wait: (_params, s) => {
        signal = s;
        return new Promise(() => {});
      },
    });
    void bridge.request('wait', { ms: 1000 }).promise.catch(() => {});
    router.dispose();
    expect(signal?.aborted).toBe(true);
  });
});
