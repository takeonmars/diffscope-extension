// Строки выделения редактора для истории по строкам. Без vscode — тестируется отдельно.
import type { LineRange } from '../../shared/protocol';

interface Position {
  line: number;
  character: number;
}

/**
 * Строки выделения с 1; без выделения — строка с курсором. Конец в начале строки (выделены
 * целые строки) её не включает.
 */
export function selectedLines(selection: { start: Position; end: Position }): LineRange {
  const from = selection.start.line + 1;
  let to = selection.end.line + 1;
  if (selection.end.character === 0 && selection.end.line > selection.start.line) to -= 1;
  return { from, to };
}
