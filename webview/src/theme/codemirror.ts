// Тема CodeMirror: цвета интерфейса из переменных VS Code (theme.css), подсветка синтаксиса —
// свои схемы через переменные --ds-syntax-*.
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Nonce из CSP вкладки — CodeMirror вставляет свои <style>. В браузере (vite dev) его нет. */
const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;

const highlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword],
    color: 'var(--ds-syntax-keyword)',
  },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--ds-syntax-string)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--ds-syntax-comment)',
    fontStyle: 'italic',
  },
  { tag: [t.number, t.bool, t.null], color: 'var(--ds-syntax-number)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--ds-syntax-type)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: 'var(--ds-syntax-function)',
  },
]);

export function editorTheme(dark: boolean): Extension {
  return [
    nonce ? EditorView.cspNonce.of(nonce) : [],
    EditorView.theme(
      {
        '&': {
          height: '100%',
          backgroundColor: 'var(--ds-bg)',
          color: 'var(--ds-fg)',
          fontSize: 'var(--ds-editor-font-size)',
        },
        '.cm-scroller': { fontFamily: 'var(--ds-editor-font)', lineHeight: '1.5' },
        '.cm-gutters': {
          backgroundColor: 'var(--ds-bg)',
          color: 'var(--ds-line-number)',
          border: 'none',
        },
        '.cm-content': { caretColor: 'var(--ds-fg)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
          backgroundColor: 'var(--ds-selection) !important',
        },
      },
      { dark },
    ),
    syntaxHighlighting(highlight),
  ];
}
