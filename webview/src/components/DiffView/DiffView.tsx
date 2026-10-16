// Обёртка над диффом CodeMirror в трёх режимах: «Ленты» (две колонки без выравнивания, ленты
// между блоками), «MergeView» (выровненные колонки), «1 колонка». Блоки считаются один раз на пару
// текстов; дифф пересоздаётся при смене текстов, режима, языка или темы; «Весь файл» — без
// пересоздания.
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { AlignedDiff } from '../../diff/aligned';
import { languageFor } from '../../diff/languages';
import { diffStats, prepareDiff } from '../../diff/model';
import { SideBySideDiff } from '../../diff/sideBySide';
import { UnifiedDiff } from '../../diff/unified';
import { editorTheme } from '../../theme/codemirror';

/** Строк контекста вокруг изменений; позже — настройка расширения. */
const CONTEXT_LINES = 4;

export type DiffMode = 'ribbons' | 'aligned' | 'unified';

export interface DiffController {
  navigate(dir: 1 | -1): void;
}

export interface DiffSummary {
  added: number;
  removed: number;
  /** Блоков для навигации (у MergeView и одной колонки CodeMirror склеивает блоки через пустую строку). */
  chunks: number;
}

interface DiffInstance {
  readonly chunkCount: number;
  navigate(dir: 1 | -1): void;
  setWholeFile(whole: boolean): void;
  destroy(): void;
}

interface Props {
  a: string;
  b: string;
  path: string;
  mode: DiffMode;
  dark: boolean;
  wholeFile: boolean;
  controller?: RefObject<DiffController | null>;
  onSummary?: (summary: DiffSummary) => void;
  onCurrentChunk?: (index: number | undefined) => void;
}

export function DiffView(props: Props) {
  const { a, b, path, mode, dark, wholeFile, controller } = props;
  const host = useRef<HTMLDivElement>(null);
  const diffRef = useRef<DiffInstance | null>(null);
  // Колбэки и wholeFile читаются через ref, чтобы их смена не пересоздавала дифф.
  const latest = useRef(props);
  latest.current = props;
  const prepared = useMemo(() => prepareDiff(a, b), [a, b]);

  useEffect(() => {
    let diff: DiffInstance | undefined;
    let cancelled = false;
    void languageFor(path).then((language) => {
      if (cancelled) return;
      const config = {
        prepared,
        extensions: [editorTheme(dark), language],
        wholeFile: latest.current.wholeFile,
        context: CONTEXT_LINES,
        onCurrentChunk: (index: number | undefined) => latest.current.onCurrentChunk?.(index),
      };
      const parent = host.current!;
      const created: DiffInstance =
        mode === 'ribbons'
          ? new SideBySideDiff(parent, config)
          : mode === 'aligned'
            ? new AlignedDiff(parent, config)
            : new UnifiedDiff(parent, config);
      diff = created;
      diffRef.current = created;
      latest.current.onSummary?.({ ...diffStats(prepared.chunks), chunks: created.chunkCount });
      if (controller) controller.current = { navigate: (dir) => created.navigate(dir) };
    });
    return () => {
      cancelled = true;
      diff?.destroy();
      diffRef.current = null;
      if (controller) controller.current = null;
    };
  }, [prepared, path, mode, dark, controller]);

  useEffect(() => {
    diffRef.current?.setWholeFile(wholeFile);
  }, [wholeFile]);

  return <div className="diff-view" ref={host} />;
}
