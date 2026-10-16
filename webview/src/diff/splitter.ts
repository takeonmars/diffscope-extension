// Перетаскиваемый разделитель колонок: доля ширины левой колонки. Двойной клик — поровну.

export const DEFAULT_SPLIT = 0.5;
/** Ширина промежутка с лентами между колонками, px; над ним — кнопка «Поменять местами». */
export const GAP_WIDTH = 32;
const MIN_SPLIT = 0.15;
const MAX_SPLIT = 0.85;

export function clampSplit(ratio: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio));
}

/**
 * Тянуть `handle` по ширине `container`: `apply` — на каждое движение, `done` — когда отпустили
 * (запомнить). Возвращает функцию отключения.
 */
export function attachSplitter(
  handle: HTMLElement,
  container: HTMLElement,
  apply: (ratio: number) => void,
  done: (ratio: number) => void,
): () => void {
  let ratio: number | undefined;
  const move = (event: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    ratio = clampSplit((event.clientX - rect.left) / rect.width);
    apply(ratio);
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    container.classList.add('ds-resizing');
    handle.addEventListener('pointermove', move);
  };
  const up = (event: PointerEvent) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    container.classList.remove('ds-resizing');
    handle.removeEventListener('pointermove', move);
    if (ratio !== undefined) done(ratio);
    ratio = undefined;
  };
  const reset = () => {
    apply(DEFAULT_SPLIT);
    done(DEFAULT_SPLIT);
  };
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
  handle.addEventListener('dblclick', reset);
  return () => {
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    handle.removeEventListener('dblclick', reset);
    handle.removeEventListener('pointermove', move);
  };
}
