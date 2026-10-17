// Граф веток в строке списка коммитов: вертикали проходящих дорожек, изгибы к родителям и от
// ответвлений, точка коммита (у merge — кольцо). Цвет — по дорожке.
import type { GraphRow } from '../../../shared/graph';

export const LANE_WIDTH = 12;
const HEIGHT = 22;
const COLORS = 8;

const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
const y = (level: 0 | 1 | 2) => (level * HEIGHT) / 2;

export function GraphCell({ row, merge }: { row: GraphRow; merge: boolean }) {
  const width = row.width * LANE_WIDTH;
  return (
    <svg className="log-graph" width={width} height={HEIGHT} aria-hidden>
      {row.lines.map((line, i) => {
        const [x1, y1] = [x(line.from[0]), y(line.from[1])];
        const [x2, y2] = [x(line.to[0]), y(line.to[1])];
        // Прямая — вертикаль; иначе плавный изгиб между уровнями.
        const d =
          x1 === x2
            ? `M${x1},${y1} V${y2}`
            : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
        return <path key={i} d={d} className={`log-graph__line c${line.color % COLORS}`} />;
      })}
      <circle
        cx={x(row.lane)}
        cy={y(1)}
        r={merge ? 3.5 : 4}
        className={`log-graph__dot c${row.color % COLORS}${merge ? ' is-merge' : ''}`}
      />
    </svg>
  );
}
