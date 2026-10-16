// Связь с расширением. Вне VS Code (vite dev в браузере) — заглушка, отвечающая сама.
import type { ExtensionToWebview, WebviewToExtension } from '../../shared/protocol';
import { createBridge } from './bridge';

interface VsCodeApi {
  postMessage(message: WebviewToExtension): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

function browserStub(deliver: (message: ExtensionToWebview) => void): VsCodeApi {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    postMessage(message) {
      if (message.kind === 'ready') {
        deliver({ kind: 'event', event: { type: 'init', title: 'DiffScope (браузер)' } });
      } else if (message.kind === 'cancel') {
        clearTimeout(timers.get(message.id));
      } else if (message.type === 'ping') {
        deliver({
          kind: 'result',
          id: message.id,
          result: { ...message.params, at: new Date().toISOString() },
        });
      } else if (message.type === 'wait') {
        const { id, params } = message;
        timers.set(
          id,
          setTimeout(
            () => deliver({ kind: 'result', id, result: { waited: params.ms } }),
            params.ms,
          ),
        );
      }
    },
  };
}

const api: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : browserStub((m) => bridge.receive(m));

export const bridge = createBridge((message) => api.postMessage(message));

window.addEventListener('message', (event: MessageEvent<ExtensionToWebview>) =>
  bridge.receive(event.data),
);
