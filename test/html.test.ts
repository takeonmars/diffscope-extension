import { describe, expect, it } from 'vitest';
import { buildHtml, createNonce } from '../src/diffPanel/html';

const input = {
  cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
  scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/dist/webview/webview.js',
  styleUri: 'https://file+.vscode-resource.vscode-cdn.net/dist/webview/webview.css',
  title: 'Дифф <a.ts>',
  nonce: 'abc123',
};

describe('HTML вкладки', () => {
  const html = buildHtml(input);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';

  it('разрешает скрипты только с nonce', () => {
    expect(csp).toContain(`default-src 'none'`);
    expect(csp).toContain(`script-src 'nonce-abc123'`);
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    expect(html).toContain(`<script nonce="abc123" type="module" src="${input.scriptUri}">`);
  });

  it('не пускает внешние адреса', () => {
    const sources = csp.split(/[;\s]+/).filter((s) => /^https?:/.test(s));
    expect(new Set(sources)).toEqual(new Set([input.cspSource]));
  });

  it('экранирует заголовок', () => {
    expect(html).toContain('<title>Дифф &#60;a.ts&#62;</title>');
  });

  it('nonce каждый раз новый', () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});
