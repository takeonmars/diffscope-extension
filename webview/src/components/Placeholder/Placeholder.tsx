// Сообщение вместо диффа: двоичный или слишком большой файл, ошибка, отменённая загрузка.
import type { ReactNode } from 'react';
import type { DiffData, SideContent } from '../../../../shared/protocol';

export function Placeholder({ children }: { children: ReactNode }) {
  return <div className="placeholder">{children}</div>;
}

/** Почему дифф не показать; undefined — обе стороны текст или файла нет. */
export function unviewableReason(data: DiffData): string | undefined {
  const sides = [data.left.content, data.right.content];
  if (sides.every((c) => c.kind === 'missing')) return 'Файла нет ни на одной из ревизий.';
  const describe = (c: SideContent, label: string) =>
    c.kind === 'binary'
      ? `${label}: двоичный файл (${formatSize(c.size)})`
      : c.kind === 'tooLarge'
        ? `${label}: файл слишком большой (${formatSize(c.size)})`
        : undefined;
  const reasons = [
    describe(data.left.content, data.left.label),
    describe(data.right.content, data.right.label),
  ].filter(Boolean);
  return reasons.length ? `${reasons.join('. ')}. Содержимое не показывается.` : undefined;
}

export function sideText(content: SideContent): string {
  return content.kind === 'text' ? content.text : '';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
