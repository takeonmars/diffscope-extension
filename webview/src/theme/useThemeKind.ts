// Светлая или тёмная тема: VS Code ставит класс на body и меняет его при смене темы без перезагрузки.
import { useSyncExternalStore } from 'react';

export type ThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';

function read(): ThemeKind {
  const list = document.body.classList;
  if (list.contains('vscode-high-contrast-light')) return 'high-contrast-light';
  if (list.contains('vscode-high-contrast')) return 'high-contrast';
  if (list.contains('vscode-dark')) return 'dark';
  return 'light';
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function useThemeKind(): ThemeKind {
  return useSyncExternalStore(subscribe, read);
}
