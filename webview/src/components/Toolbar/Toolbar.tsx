// Панель вкладки: слева путь файла и сводка, справа переключатели (children).
import type { ReactNode } from 'react';

export function Toolbar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="toolbar">
      <span className="toolbar__title">{title}</span>
      {children}
    </header>
  );
}
