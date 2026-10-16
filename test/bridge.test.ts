// Мост вкладки и маршрутизатор расширения, соединённые напрямую — без VS Code.
import { describe, expect, it, vi } from 'vitest';
import type {
  DiffData,
  DiffSide,
  ExtensionToWebview,
  WebviewToExtension,
} from '../shared/protocol';
import { MessageRouter, type Handlers } from '../src/diffPanel/messageRouter';
import { DiffSession, WORKTREE, type Revision } from '../src/diffPanel/session';
import { CancelledError, createBridge } from '../webview/src/bridge';

const side = (label: string): DiffSide => ({ label, content: { kind: 'text', text: label } });
const data: DiffData = { path: 'a.ts', left: side('L'), right: side('R') };

function fakeHandlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    load: async () => data,
    pickRef: async () => ({ changed: false }),
    swap: async () => null,
    saveLayout: async () => null,
    ...overrides,
  };
}

/** Обработчик, который ждёт отмены и запоминает её сигнал. */
function hanging() {
  const state: { signal?: AbortSignal } = {};
  const handler = (_params: unknown, signal: AbortSignal) => {
    state.signal = signal;
    return new Promise<never>(() => {});
  };
  return { state, handler };
}

function connect(handlers: Handlers = fakeHandlers()) {
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
    expect(await bridge.request('load', {}).promise).toEqual(data);
    expect(toExtension[0]).toMatchObject({ kind: 'request', id: 1, type: 'load' });
    expect(toWebview[0]).toMatchObject({ kind: 'result', id: 1 });
  });

  it('передаёт ошибку обработчика', async () => {
    const { bridge } = connect(
      fakeHandlers({
        load: async () => {
          throw new Error('сломалось');
        },
      }),
    );
    await expect(bridge.request('load', {}).promise).rejects.toThrow('сломалось');
  });

  it('отмена прерывает обработчик и не присылает ответ', async () => {
    const { state, handler } = hanging();
    const { bridge, toExtension, toWebview } = connect(fakeHandlers({ load: handler }));
    const req = bridge.request('load', {});
    req.cancel();
    await expect(req.promise).rejects.toBeInstanceOf(CancelledError);
    expect(state.signal?.aborted).toBe(true);
    expect(toExtension.at(-1)).toEqual({ kind: 'cancel', id: 1 });
    expect(toWebview).toHaveLength(0);
  });

  it('requestLatest отменяет предыдущий запрос того же типа', async () => {
    let calls = 0;
    const { state, handler } = hanging();
    const { bridge } = connect(
      fakeHandlers({ load: (p, s) => (++calls === 1 ? handler(p, s) : Promise.resolve(data)) }),
    );
    const first = bridge.requestLatest('load', {});
    const second = bridge.requestLatest('load', {});
    await expect(first.promise).rejects.toBeInstanceOf(CancelledError);
    expect(state.signal?.aborted).toBe(true);
    await expect(second.promise).resolves.toEqual(data);
  });

  it('неизвестный тип запроса — ошибка', async () => {
    const { bridge } = connect({} as Handlers);
    await expect(bridge.request('load', {}).promise).rejects.toThrow('Неизвестный запрос');
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
    const { state, handler } = hanging();
    const { bridge, router } = connect(fakeHandlers({ load: handler }));
    void bridge.request('load', {}).promise.catch(() => {});
    router.dispose();
    expect(state.signal?.aborted).toBe(true);
  });
});

describe('DiffSession', () => {
  const head: Revision = { kind: 'rev', rev: 'HEAD', label: 'HEAD' };
  const main: Revision = { kind: 'rev', rev: 'refs/heads/main', label: 'main', description: 'msg' };
  const signal = new AbortController().signal;

  function session(picked?: Revision) {
    const onChange = vi.fn();
    const s = new DiffSession('src/app.ts', head, WORKTREE, {
      loadSide: async (r) => side(r.kind === 'worktree' ? 'wt' : r.label),
      pickRevision: async () => picked,
      onChange,
    });
    return { s, onChange, h: s.handlers() };
  }

  it('заголовок вкладки', () => {
    expect(session().s.title).toBe('app.ts (HEAD ↔ Рабочая копия)');
  });

  it('load отдаёт обе стороны', async () => {
    const { h } = session();
    expect(await h.load({}, signal)).toEqual({
      path: 'src/app.ts',
      left: side('HEAD'),
      right: side('wt'),
    });
  });

  it('выбор ревизии меняет сторону и заголовок', async () => {
    const { s, h, onChange } = session(main);
    expect(await h.pickRef({ side: 'right' }, signal)).toEqual({ changed: true });
    expect(s.right).toBe(main);
    expect(onChange).toHaveBeenCalledOnce();
    expect(s.title).toBe('app.ts (HEAD ↔ main)');
  });

  it('закрытый список ничего не меняет', async () => {
    const { s, h, onChange } = session(undefined);
    expect(await h.pickRef({ side: 'left' }, signal)).toEqual({ changed: false });
    expect(s.left).toBe(head);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('swap', async () => {
    const { s, h } = session();
    await h.swap({}, signal);
    expect([s.left, s.right]).toEqual([WORKTREE, head]);
  });
});
