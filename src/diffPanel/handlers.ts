// Обработчики запросов вкладки диффа.
import type { Handlers } from './messageRouter';

export function createHandlers(): Handlers {
  return {
    async ping({ text }) {
      return { text, at: new Date().toISOString() };
    },
    wait({ ms }, signal) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ waited: ms }), ms);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Отменено'));
        });
      });
    },
  };
}
