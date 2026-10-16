// Связь с расширением. Вне VS Code (vite dev в браузере) — заглушка с тестовыми примерами.
import type { ExtensionToWebview, WebviewToExtension } from '../../shared/protocol';
import { createBridge } from './bridge';
import { browserStub } from './dev/browserStub';

interface VsCodeApi {
  postMessage(message: WebviewToExtension): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : import.meta.env.DEV
      ? browserStub((m) => bridge.receive(m))
      : { postMessage: () => {} };

export const bridge = createBridge((message) => api.postMessage(message));

window.addEventListener('message', (event: MessageEvent<ExtensionToWebview>) =>
  bridge.receive(event.data),
);
