import { describe, expect, it } from 'vitest';
import { parseBatchCheck } from '../src/git/content';
import { LruCache } from '../src/git/cache';
import { parseLog } from '../src/git/parsers/log';
import { parseNameStatus, parseNumstat } from '../src/git/parsers/nameStatus';
import { parseRefs } from '../src/git/refs';

describe('parseNameStatus', () => {
  it('все виды статусов', () => {
    const out = [
      'M',
      'a.ts',
      'A',
      'b.ts',
      'D',
      'c.ts',
      'R087',
      'old.ts',
      'new.ts',
      'C100',
      'x',
      'y',
      'T',
      'link',
      '',
    ].join('\0');
    expect(parseNameStatus(out)).toEqual([
      { status: 'modified', path: 'a.ts' },
      { status: 'added', path: 'b.ts' },
      { status: 'deleted', path: 'c.ts' },
      { status: 'renamed', path: 'new.ts', oldPath: 'old.ts', similarity: 87 },
      { status: 'copied', path: 'y', oldPath: 'x', similarity: 100 },
      { status: 'typeChanged', path: 'link' },
    ]);
  });

  it('пустой вывод', () => {
    expect(parseNameStatus('')).toEqual([]);
  });
});

describe('parseLog', () => {
  it('поля через NUL, коммиты через NUL', () => {
    const commit = (h: string, parents: string) =>
      [h, h.slice(0, 7), parents, 'Имя', 'a@b.c', '1700000000', 'Сообщение: с\tтабом'].join('\0');
    const out = `${commit('a'.repeat(40), 'b'.repeat(40))}\0${commit('b'.repeat(40), '')}\0`;
    expect(parseLog(out)).toEqual([
      {
        hash: 'a'.repeat(40),
        shortHash: 'aaaaaaa',
        parents: ['b'.repeat(40)],
        author: 'Имя',
        email: 'a@b.c',
        date: 1_700_000_000_000,
        subject: 'Сообщение: с\tтабом',
      },
      expect.objectContaining({ hash: 'b'.repeat(40), parents: [] }),
    ]);
  });
});

describe('parseRefs', () => {
  it('виды ссылок, origin/HEAD и чужие префиксы пропущены', () => {
    const line = (...f: string[]) => f.join('\0');
    const out = [
      line('refs/heads/main', '1'.repeat(40), '', 'msg'),
      line('refs/remotes/origin/HEAD', '1'.repeat(40), '', ''),
      line('refs/remotes/origin/feat/x', '2'.repeat(40), '', 's'),
      line('refs/tags/v1', '3'.repeat(40), '4'.repeat(40), 'tag'),
      line('refs/stash', '5'.repeat(40), '', ''),
    ].join('\n');
    expect(parseRefs(out).map((r) => [r.kind, r.name, r.commit[0]])).toEqual([
      ['branch', 'main', '1'],
      ['remote', 'origin/feat/x', '2'],
      ['tag', 'v1', '4'],
    ]);
  });
});

describe('parseBatchCheck', () => {
  it('объект и отсутствие', () => {
    expect(parseBatchCheck(`${'a'.repeat(40)} blob 12\n`)).toEqual({
      object: 'a'.repeat(40),
      type: 'blob',
      size: 12,
    });
    expect(parseBatchCheck('HEAD:x missing\n')).toBeUndefined();
  });
});

describe('LruCache', () => {
  it('вытесняет давно не использованное по суммарному размеру', () => {
    const cache = new LruCache<string, string>(10, (v) => v.length);
    cache.set('a', '1234');
    cache.set('b', '1234');
    cache.get('a'); // a свежее b
    cache.set('c', '1234');
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual(['1234', undefined, '1234']);
    cache.set('huge', '12345678901');
    expect(cache.get('huge')).toBeUndefined();
  });
});

describe('parseNumstat', () => {
  it('обычный, двоичный, переименованный', () => {
    const out = ['3\t1\ta.ts', '-\t-\timg.png', '0\t2\t', 'old.ts', 'new.ts', ''].join('\0');
    expect(parseNumstat(out)).toEqual([
      { path: 'a.ts', added: 3, removed: 1, binary: false },
      { path: 'img.png', added: 0, removed: 0, binary: true },
      { path: 'new.ts', added: 0, removed: 2, binary: false },
    ]);
  });
});
