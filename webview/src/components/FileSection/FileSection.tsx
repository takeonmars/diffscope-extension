// Файл во вкладке «все файлы»: закреплённый заголовок (статус, путь, +N −M, «Весь файл»,
// «В отдельной вкладке», свернуть) и дифф с лентами по высоте содержимого. Содержимое
// загружается, когда секция подходит к видимой области.
import { useEffect, useRef, useState } from 'react';
import type { DiffSide, MultiFile } from '../../../../shared/protocol';
import { CancelledError } from '../../bridge';
import { bridge } from '../../vscodeApi';
import { DiffStats } from '../DiffStats/DiffStats';
import { DiffView } from '../DiffView/DiffView';
import { sideText, unviewableReason } from '../Placeholder/Placeholder';

const STATUS_LETTER: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typeChanged: 'T',
  unmerged: 'U',
};

/** Высота строки диффа, px — для оценки высоты секции до загрузки. */
const LINE_HEIGHT = 19.5;

interface Props {
  index: number;
  file: MultiFile;
  /** Прокручиваемый контейнер — для подгрузки по мере прокрутки. */
  scroller: HTMLElement | null;
  dark: boolean;
  split: number;
  onSplitChange(ratio: number): void;
}

type Content = { left: DiffSide; right: DiffSide };

export function FileSection({ index, file, scroller, dark, split, onSplitChange }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [content, setContent] = useState<Content>();
  const [error, setError] = useState<string>();
  const [wholeFile, setWholeFile] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Подгрузка: секция в пределах экрана-двух от видимой области.
  useEffect(() => {
    const node = ref.current;
    if (!node || !scroller || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { root: scroller, rootMargin: '1200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [scroller, near]);

  useEffect(() => {
    if (!near || file.binary) return;
    const req = bridge.request('multiFile', { index });
    req.promise.then(setContent, (e: Error) => {
      if (!(e instanceof CancelledError)) setError(e.message);
    });
    return req.cancel;
  }, [near, index, file.binary]);

  const reason =
    content && unviewableReason({ path: file.path, left: content.left, right: content.right });
  const estimate = Math.min(2000, ((file.added ?? 0) + (file.removed ?? 0) + 9) * LINE_HEIGHT);

  return (
    <section className="file-section" id={`file-${index}`} ref={ref}>
      <header className="file-header">
        <button
          className="file-header__toggle"
          onClick={() => setHidden((h) => !h)}
          aria-expanded={!hidden}
          title={hidden ? 'Показать' : 'Скрыть'}
        >
          {hidden ? '▸' : '▾'}
        </button>
        <span className={`file-header__status file-header__status--${file.status}`}>
          {STATUS_LETTER[file.status] ?? '?'}
        </span>
        <span className="file-header__path" title={file.path}>
          {file.oldPath && <span className="file-header__old">{file.oldPath} → </span>}
          {file.path}
        </span>
        {file.binary ? (
          <span className="file-header__note">двоичный файл</span>
        ) : (
          <DiffStats added={file.added ?? 0} removed={file.removed ?? 0} />
        )}
        <span className="file-header__actions">
          <label className="checkbox" title="Показать файл целиком, без сворачивания">
            <input
              type="checkbox"
              checked={wholeFile}
              onChange={(e) => setWholeFile(e.target.checked)}
            />
            Весь файл
          </label>
          <button
            onClick={() => void bridge.request('openFile', { index }).promise.catch(() => {})}
            title="Открыть дифф файла в отдельной вкладке: навигация, MergeView, одна колонка"
          >
            В отдельной вкладке
          </button>
        </span>
      </header>
      {!hidden && (
        <div className="file-body">
          {file.binary ? (
            <div className="file-body__note">Двоичный файл — содержимое не показывается.</div>
          ) : error ? (
            <div className="file-body__note error">{error}</div>
          ) : reason ? (
            <div className="file-body__note">{reason}</div>
          ) : content ? (
            <DiffView
              a={sideText(content.left.content)}
              b={sideText(content.right.content)}
              path={file.path}
              mode="ribbons"
              layout="auto"
              dark={dark}
              wholeFile={wholeFile}
              split={split}
              onSplitChange={onSplitChange}
            />
          ) : (
            <div className="file-body__placeholder" style={{ height: estimate }} />
          )}
        </div>
      )}
    </section>
  );
}
