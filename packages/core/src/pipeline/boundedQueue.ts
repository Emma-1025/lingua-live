export class BoundedAsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly dequeueWaiters: Array<(value: T) => void> = [];
  private readonly enqueueWaiters: Array<() => void> = [];

  constructor(private readonly maxSize: number) {}

  get size(): number {
    return this.items.length;
  }

  get capacity(): number {
    return this.maxSize;
  }

  async enqueue(item: T): Promise<void> {
    if (this.dequeueWaiters.length > 0) {
      const resolve = this.dequeueWaiters.shift();
      resolve?.(item);
      return;
    }

    if (this.items.length >= this.maxSize) {
      await new Promise<void>((resolve) => {
        this.enqueueWaiters.push(resolve);
      });
    }

    this.items.push(item);
  }

  async dequeue(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) {
      this.releaseEnqueueWaiter();
      return item;
    }

    return new Promise<T>((resolve) => {
      this.dequeueWaiters.push(resolve);
    });
  }

  clear(): void {
    this.items.length = 0;
    this.dequeueWaiters.length = 0;
    this.enqueueWaiters.length = 0;
  }

  private releaseEnqueueWaiter(): void {
    const waiter = this.enqueueWaiters.shift();
    waiter?.();
  }
}
