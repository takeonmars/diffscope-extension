// Ревизии над колонками: кнопка слева и справа открывает выбор ревизии (QuickPick VS Code),
// между ними — «Поменять местами». Сетка совпадает с колонками диффа.
import type { DiffSide, SideName } from '../../../../shared/protocol';
import { GAP_WIDTH } from '../../diff/splitter';

interface Props {
  /** Доля ширины левой колонки — кнопки ревизий стоят над своими колонками. */
  split: number;
  left?: DiffSide;
  right?: DiffSide;
  disabled: boolean;
  onPick(side: SideName): void;
  onSwap(): void;
}

export function RevisionBar({ split, left, right, disabled, onPick, onSwap }: Props) {
  return (
    <div
      className="revision-bar"
      style={{
        gridTemplateColumns: `minmax(0, ${split}fr) ${GAP_WIDTH}px minmax(0, ${1 - split}fr)`,
      }}
    >
      <RevisionButton side={left} disabled={disabled} onClick={() => onPick('left')} />
      <button
        className="revision-bar__swap"
        onClick={onSwap}
        disabled={disabled}
        title="Поменять местами"
        aria-label="Поменять местами"
      >
        ⇄
      </button>
      <RevisionButton side={right} disabled={disabled} onClick={() => onPick('right')} />
    </div>
  );
}

function RevisionButton({
  side,
  disabled,
  onClick,
}: {
  side?: DiffSide;
  disabled: boolean;
  onClick(): void;
}) {
  const missing = side?.content.kind === 'missing';
  return (
    <button
      className="revision"
      onClick={onClick}
      disabled={disabled}
      title={
        [side?.label, side?.path && `путь: ${side.path}`, side?.description]
          .filter(Boolean)
          .join(' — ') || 'Выбрать ревизию'
      }
    >
      <span className="revision__label">{side?.label ?? '…'}</span>
      {side?.path && <span className="revision__path">был {side.path}</span>}
      {side?.description && <span className="revision__description">{side.description}</span>}
      {missing && <span className="revision__missing">нет файла</span>}
      <span className="revision__chevron" aria-hidden>
        ▾
      </span>
    </button>
  );
}
