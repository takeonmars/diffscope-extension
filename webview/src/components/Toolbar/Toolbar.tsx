// Панель вкладки. Пока заглушка: ревизии и режимы появятся на этапе 3.
export function Toolbar({ title }: { title: string }) {
  return (
    <header className="toolbar">
      <span className="toolbar__title">{title}</span>
      <button disabled>левая ревизия</button>
      <button disabled title="Поменять местами">
        ⇄
      </button>
      <button disabled>правая ревизия</button>
    </header>
  );
}
