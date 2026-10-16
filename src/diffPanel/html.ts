// HTML вкладки диффа с Content Security Policy. Не зависит от vscode — тестируется отдельно.
import { randomBytes } from 'node:crypto';

export interface HtmlInput {
  /** webview.cspSource — источник локальных ресурсов вкладки. */
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  title: string;
  nonce?: string;
}

export function createNonce(): string {
  return randomBytes(16).toString('base64url');
}

export function buildHtml({
  cspSource,
  scriptUri,
  styleUri,
  title,
  nonce = createNonce(),
}: HtmlInput): string {
  // style-src с nonce — CodeMirror добавляет свои <style> (EditorView.cspNonce).
  const csp = [
    `default-src 'none'`,
    // cspSource — для частей сборки, загружаемых по требованию (языки подсветки).
    `script-src 'nonce-${nonce}' ${cspSource}`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
    `img-src ${cspSource} data:`,
  ].join('; ');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="csp-nonce" content="${nonce}">
  <link rel="stylesheet" href="${styleUri}">
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
