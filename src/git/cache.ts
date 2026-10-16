// LRU-кеш с ограничением суммарного размера. Содержимое по хешу blob неизменно, поэтому
// инвалидация не нужна — только вытеснение старого.

export class LruCache<K, V> {
  private readonly items = new Map<K, { value: V; size: number }>();
  private total = 0;

  constructor(
    private readonly maxSize: number,
    private readonly sizeOf: (value: V) => number = () => 1,
  ) {}

  get(key: K): V | undefined {
    const item = this.items.get(key);
    if (!item) return undefined;
    // Map хранит порядок вставки: переставляем в конец как самый свежий.
    this.items.delete(key);
    this.items.set(key, item);
    return item.value;
  }

  set(key: K, value: V): void {
    const size = this.sizeOf(value);
    if (size > this.maxSize) return;
    const old = this.items.get(key);
    if (old) {
      this.total -= old.size;
      this.items.delete(key);
    }
    this.items.set(key, { value, size });
    this.total += size;
    for (const [k, item] of this.items) {
      if (this.total <= this.maxSize) break;
      this.items.delete(k);
      this.total -= item.size;
    }
  }

  get size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
    this.total = 0;
  }
}
