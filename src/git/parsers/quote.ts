// Пути в выводе git: со спецсимволами (кавычки, табуляция, перевод строки) git берёт путь в
// кавычки с C-экранированием; байты UTF-8 при core.quotepath=off остаются как есть.

/** Путь без кавычек и экранирования; путь не в кавычках — как есть. */
export function unquotePath(text: string): string {
  if (!text.startsWith('"')) return text;
  const body = text.slice(1, text.lastIndexOf('"'));
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[++i];
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

const ESCAPES: Record<string, number> = {
  n: 10,
  t: 9,
  r: 13,
  '"': 34,
  '\\': 92,
  a: 7,
  b: 8,
  f: 12,
  v: 11,
};
