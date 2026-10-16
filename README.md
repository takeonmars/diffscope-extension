# diffscope-extension

Расширение VS Code / Cursor для просмотра истории и диффов git с лентами между колонками, как в
WebStorm. Только чтение репозитория. План — в файле `diffscope-plan.md`.

## Разработка

```bash
npm install
npm run check        # типы, линтер, тесты
npm run build        # dist/extension.js и dist/webview/
npm run dev:webview  # вкладка диффа в браузере, с заглушкой расширения
npm run package      # diffscope-extension-<версия>.vsix
```

Отладка: в VS Code — F5 («Запустить расширение»), в новом окне открыть папку с git-репозиторием.
Команды — в контекстном меню редактора, вкладки и проводника (пункт **DiffScope ▸**) и в палитре
команд:

- «Сравнить с…» — файл между двумя ревизиями;
- «Показать историю» — коммиты, менявшие файл;
- «Показать историю по строкам» — коммиты, менявшие выделенные строки (только в редакторе);
- «Сравнить ветки» — все отличающиеся файлы двух ревизий.

Инструменты разработчика вкладки — «Developer: Open Webview Developer Tools»; журнал
git-команд — Output → DiffScope (уровень Trace).

Установка: «Extensions: Install from VSIX…» в VS Code или Cursor.
