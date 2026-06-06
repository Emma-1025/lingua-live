import { describe, expect, it } from 'vitest';
import { BoundedAsyncQueue } from './boundedQueue.js';

describe('BoundedAsyncQueue', () => {
  it('applies back-pressure when the queue is full', async () => {
    const queue = new BoundedAsyncQueue<number>(2);
    await queue.enqueue(1);
    await queue.enqueue(2);
    expect(queue.size).toBe(2);

    let released = false;
    const third = queue.enqueue(3).then(() => {
      released = true;
    });

    await Promise.resolve();
    expect(released).toBe(false);

    await queue.dequeue();
    await third;
    expect(released).toBe(true);
    expect(queue.size).toBe(2);
  });
});
