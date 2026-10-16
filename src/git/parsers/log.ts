// Разбор `git log -z --format=LOG_FORMAT`: поля разделены NUL, коммиты — тоже NUL (-z).

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  /** Дата автора, мс с 1970 года. */
  date: number;
  subject: string;
}

const FIELDS = ['%H', '%h', '%P', '%an', '%ae', '%at', '%s'];

export const LOG_FORMAT = `--format=${FIELDS.join('%x00')}`;

export function parseLog(output: string): Commit[] {
  const parts = output.split('\0');
  const commits: Commit[] = [];
  for (let i = 0; i + FIELDS.length <= parts.length; i += FIELDS.length) {
    // Между коммитами -z ставит перевод строки перед следующим (в старых git) — убираем.
    const [hash, shortHash, parents, author, email, time, subject] = parts
      .slice(i, i + FIELDS.length)
      .map((p, k) => (k === 0 ? p.replace(/^\n/, '') : p));
    if (!hash) continue;
    commits.push({
      hash,
      shortHash,
      parents: parents ? parents.split(' ') : [],
      author,
      email,
      date: Number(time) * 1000,
      subject,
    });
  }
  return commits;
}
