// Панель вкладки. Ревизии и режимы появятся на этапе 3; пока — элементы прототипа (children).
import type { ReactNode } from 'react';

export function Toolbar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="toolbar">
      <span className="toolbar__title">{title}</span>
      {children}
    </header>
  );
}
