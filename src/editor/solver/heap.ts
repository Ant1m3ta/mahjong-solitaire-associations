export class MinHeap<T> {
  private keys: number[] = [];
  private values: T[] = [];

  size(): number {
    return this.keys.length;
  }

  push(key: number, value: T): void {
    this.keys.push(key);
    this.values.push(value);
    this.bubbleUp(this.keys.length - 1);
  }

  pop(): { key: number; value: T } | null {
    if (this.keys.length === 0) return null;
    const topKey = this.keys[0];
    const topValue = this.values[0];
    const lastKey = this.keys.pop()!;
    const lastValue = this.values.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      this.bubbleDown(0);
    }
    return { key: topKey, value: topValue };
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) return;
      this.swap(parent, i);
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.keys.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.keys[l] < this.keys[smallest]) smallest = l;
      if (r < n && this.keys[r] < this.keys[smallest]) smallest = r;
      if (smallest === i) return;
      this.swap(smallest, i);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tk = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tk;
    const tv = this.values[a];
    this.values[a] = this.values[b];
    this.values[b] = tv;
  }
}
