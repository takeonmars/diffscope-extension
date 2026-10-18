// Нижняя панель после работы с DiffScope: наши команды переключают её на раздел DiffScope, и он
// оставался открытым после закрытия вкладок. Какая панель была до этого, VS Code расширению не
// сообщает, поэтому возвращаемся в терминал (если он есть), иначе закрываем панель.
import * as vscode from 'vscode';

export async function leaveDiffScopePanel(): Promise<void> {
  if (vscode.window.terminals.length) {
    // Показать существующий терминал, не создавая новый; фокус — обратно в редактор.
    await vscode.commands.executeCommand('workbench.action.terminal.focus');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  } else {
    await vscode.commands.executeCommand('workbench.action.closePanel');
  }
}
