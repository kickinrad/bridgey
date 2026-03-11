/**
 * Per-agent sequential request queue.
 * Tasks for the same agent run one at a time.
 * Tasks for different agents run concurrently.
 */
export class AgentQueue {
    queues = new Map();
    running = new Set();
    async enqueue(agent, fn) {
        return new Promise((resolve, reject) => {
            if (!this.queues.has(agent)) {
                this.queues.set(agent, []);
            }
            this.queues.get(agent).push({ fn, resolve, reject });
            this.process(agent);
        });
    }
    size(agent) {
        return this.queues.get(agent)?.length ?? 0;
    }
    async process(agent) {
        if (this.running.has(agent))
            return;
        this.running.add(agent);
        const queue = this.queues.get(agent);
        while (queue.length > 0) {
            const task = queue.shift();
            try {
                const result = await task.fn();
                task.resolve(result);
            }
            catch (err) {
                task.reject(err instanceof Error ? err : new Error(String(err)));
            }
        }
        this.running.delete(agent);
        if (queue.length === 0) {
            this.queues.delete(agent);
        }
    }
}
