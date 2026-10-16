// Обёртка над диффом CodeMirror: создаёт его в div и пересоздаёт при смене текстов или темы.
// «Весь файл» переключается без пересоздания; навигация — через controller.
import { javascript } from '@codemirror/lang-javascript';
import { useEffect, useRef, type RefObject } from 'react';
import { SideBySideDiff } from '../../diff/sideBySide';
import { editorTheme } from '../../theme/codemirror';

/** Строк контекста вокруг изменений; позже — настройка расширения. */
const CONTEXT_LINES = 4;

export interface DiffStats {
  chunks: number;
  diffTime: number;
  renderTime: number;
}

export interface DiffController {
  navigate(dir: 1 | -1): void;
}

interface Props {
  a: string;
  b: string;
  dark: boolean;
  wholeFile: boolean;
  controller?: RefObject<DiffController | null>;
  onStats?: (stats: DiffStats) => void;
  onCurrentChunk?: (index: number | undefined) => void;
}

export function DiffView({ a, b, dark, wholeFile, controller, onStats, onCurrentChunk }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const diffRef = useRef<SideBySideDiff | null>(null);
  // Колбэки и wholeFile читаются через ref, чтобы их смена не пересоздавала дифф.
  const latest = useRef({ wholeFile, onStats, onCurrentChunk });
  latest.current = { wholeFile, onStats, onCurrentChunk };

  useEffect(() => {
    const started = performance.now();
    const diff = new SideBySideDiff(host.current!, {
      a,
      b,
      extensions: [editorTheme(dark), javascript({ typescript: true })],
      wholeFile: latest.current.wholeFile,
      context: CONTEXT_LINES,
      onCurrentChunk: (index) => latest.current.onCurrentChunk?.(index),
    });
    diffRef.current = diff;
    latest.current.onStats?.({
      chunks: diff.chunks.length,
      diffTime: diff.diffTime,
      renderTime: performance.now() - started,
    });
    if (controller) controller.current = { navigate: (dir) => diff.navigate(dir) };
    return () => {
      diff.destroy();
      diffRef.current = null;
      if (controller) controller.current = null;
    };
  }, [a, b, dark, controller]);

  useEffect(() => {
    diffRef.current?.setWholeFile(wholeFile);
  }, [wholeFile]);

  return <div className="diff-view" ref={host} />;
}
