// Сводка изменений как на GitHub: «+10 −3» и пять квадратиков — доля добавленного и удалённого.
import { statsBlocks } from '../../diff/model';

export function DiffStats({ added, removed }: { added: number; removed: number }) {
  const blocks = statsBlocks(added, removed);
  const squares = [
    ...Array<string>(blocks.added).fill('added'),
    ...Array<string>(blocks.removed).fill('removed'),
    ...Array<string>(blocks.neutral).fill('neutral'),
  ];
  const title =
    added || removed ? `Добавлено строк: ${added}, удалено: ${removed}` : 'Изменений нет';
  return (
    <span className="stats" title={title}>
      {added || removed ? (
        <>
          <span className="stats__added">+{added}</span>
          <span className="stats__removed">−{removed}</span>
        </>
      ) : (
        <span className="stats__none">без изменений</span>
      )}
      <span className="stats__blocks" aria-hidden>
        {squares.map((kind, i) => (
          <span key={i} className={`stats__block stats__block--${kind}`} />
        ))}
      </span>
    </span>
  );
}
