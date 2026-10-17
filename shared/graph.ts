// Граф веток для окна Git Log: раскладка коммитов (в порядке --topo-order) по дорожкам за один
// проход, как в git log --graph и WebStorm. Каждая дорожка ждёт хеш следующего коммита; коммит
// встаёт на свою дорожку, первый родитель продолжает её, остальные — новые дорожки или изгиб к
// уже ждущей. Без DOM — тестируется отдельно.

export interface GraphCommit {
  hash: string;
  parents: readonly string[];
}

/** Линия в строке графа: из (x1, y1) в (x2, y2); x — номер дорожки, y — 0 верх, 1 середина, 2 низ. */
export interface GraphLine {
  from: [lane: number, y: 0 | 1];
  to: [lane: number, y: 1 | 2];
  color: number;
}

export interface GraphRow {
  /** Дорожка точки коммита. */
  lane: number;
  color: number;
  lines: GraphLine[];
  /** Сколько дорожек занято в этой строке — ширина графа. */
  width: number;
}

export function layoutGraph(commits: readonly GraphCommit[]): GraphRow[] {
  /** Хеш, которого ждёт дорожка; null — свободна. */
  const lanes: (string | null)[] = [];
  /** Цвет дорожки — номер «ветки»: новая ветка — новый цвет. */
  const colors: number[] = [];
  let nextColor = 0;
  const rows: GraphRow[] = [];

  const freeLane = () => {
    const free = lanes.indexOf(null);
    if (free !== -1) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const before = [...lanes];
    const beforeColors = [...colors];
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      // Вершина ветки: её ещё никто не ждёт.
      lane = freeLane();
      colors[lane] = nextColor++;
    }
    const color = colors[lane];
    const lines: GraphLine[] = [];

    // Все дорожки, ждавшие этот коммит, сходятся в его точку (ветки, ответвившиеся от него).
    for (let j = 0; j < before.length; j++) {
      if (before[j] === commit.hash) {
        lines.push({ from: [j, 0], to: [lane, 1], color: beforeColors[j] });
        if (j !== lane) lanes[j] = null;
      }
    }

    // Родители: первый продолжает дорожку коммита, остальные — к ждущей дорожке или новой.
    lanes[lane] = null;
    commit.parents.forEach((parent, i) => {
      // Первый родитель всегда продолжает дорожку коммита (линия идёт прямо), даже если его уже
      // ждёт другая дорожка: они сойдутся в точке самого родителя.
      if (i === 0) {
        lanes[lane] = parent;
        lines.push({ from: [lane, 1], to: [lane, 2], color });
        return;
      }
      const waiting = lanes.indexOf(parent);
      if (waiting !== -1) {
        lines.push({ from: [lane, 1], to: [waiting, 2], color: colors[waiting] });
        return;
      }
      const target = freeLane();
      colors[target] = nextColor++;
      lanes[target] = parent;
      lines.push({ from: [lane, 1], to: [target, 2], color: colors[target] });
    });

    // Остальные дорожки проходят строку насквозь.
    for (let j = 0; j < before.length; j++) {
      if (before[j] !== null && before[j] !== commit.hash && lanes[j] === before[j]) {
        lines.push({ from: [j, 0], to: [j, 2], color: beforeColors[j] });
      }
    }

    // Пустые дорожки справа не держим — граф не расползается вширь.
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.length = lanes.length;
    }
    const width = Math.max(
      lane + 1,
      before.length,
      ...lines.map((l) => Math.max(l.from[0], l.to[0]) + 1),
    );
    rows.push({ lane, color, lines, width });
  }
  return rows;
}
