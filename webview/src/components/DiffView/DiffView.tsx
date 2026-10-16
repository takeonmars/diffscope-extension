// Обёртка над диффом CodeMirror в трёх режимах: «Ленты» (две колонки без выравнивания, ленты
// между блоками), «MergeView» (выровненные колонки), «1 колонка». Блоки считаются один раз на пару
// текстов; дифф пересоздаётся при смене текстов, режима, языка или темы; «Весь файл» — без
// пересоздания.
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { AlignedDiff } from '../../diff/aligned';
import { languageFor } from '../../diff/languages';
import { diffStats, prepareDiff } from '../../../../shared/diffModel';
import { SideBySideDiff } from '../../diff/sideBySide';
import { UnifiedDiff } from '../../diff/unified';
import { editorTheme } from '../../theme/codemirror';
import type { FragmentConfig } from '../../diff/fragment';

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
  setSplit(ratio: number): void;
  destroy(): void;
}

interface Props {
  a: string;
  b: string;
  path: string;
  mode: DiffMode;
  dark: boolean;
  wholeFile: boolean;
  /** Сдвиг номеров строк колонок (режим «Только выделенные строки»). */
  lineOffset?: { a: number; b: number };
  /** Фрагмент истории: подсветка и прокрутка к нему. */
  fragment?: FragmentConfig;
  /** Доля ширины левой колонки. */
  split: number;
  /** Разделитель отпустили. */
  onSplitChange?: (ratio: number) => void;
  controller?: RefObject<DiffController | null>;
  /** Высота по содержимому, прокрутка общая (вкладка «все файлы»; только «Ленты»). */
  layout?: 'scroll' | 'auto';
  onSummary?: (summary: DiffSummary) => void;
  onCurrentChunk?: (index: number | undefined) => void;
}

export function DiffView(props: Props) {
  const { a, b, path, mode, dark, wholeFile, controller } = props;
  // Объекты сравниваются по содержимому: новый объект с теми же числами не пересоздаёт дифф.
  const offsetKey = JSON.stringify(props.lineOffset ?? null);
  const fragmentKey = JSON.stringify(props.fragment ?? null);
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
        lineOffset: latest.current.lineOffset,
        fragment: latest.current.fragment,
        split: latest.current.split,
        layout: latest.current.layout,
        onSplitChange: (ratio: number) => latest.current.onSplitChange?.(ratio),
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
  }, [prepared, path, mode, dark, controller, offsetKey, fragmentKey, props.layout]);

  useEffect(() => {
    diffRef.current?.setWholeFile(wholeFile);
  }, [wholeFile]);

  useEffect(() => {
    diffRef.current?.setSplit(props.split);
  }, [props.split]);

  return (
    <div
      className={props.layout === 'auto' ? 'diff-view diff-view--auto' : 'diff-view'}
      ref={host}
    />
  );
}
