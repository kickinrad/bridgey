type QueuedTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
};

/**
 * Per-agent sequential request queue.
 * Tasks for the same agent run one at a time.
 * Tasks for different agents run concurrently.
 */
export class AgentQueue {
  private queues = new Map<string, QueuedTask<any>[]>();
  private running = new Set<string>();

  async enqueue<T>(agent: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.queues.has(agent)) {
        this.queues.set(agent, []);
      }
      this.queues.get(agent)!.push({ fn, resolve, reject });
      this.process(agent);
    });
  }

  size(agent: string): number {
    return this.queues.get(agent)?.length ?? 0;
  }

  private async process(agent: string): Promise<void> {
    if (this.running.has(agent)) return;
    this.running.add(agent);

    const queue = this.queues.get(agent)!;

    while (queue.length > 0) {
      const task = queue.shift()!;
      try {
        const result = await task.fn();
        task.resolve(result);
      } catch (err) {
        task.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }

    this.running.delete(agent);
    if (queue.length === 0) {
      this.queues.delete(agent);
    }
  }
}
