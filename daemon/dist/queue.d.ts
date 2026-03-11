/**
 * Per-agent sequential request queue.
 * Tasks for the same agent run one at a time.
 * Tasks for different agents run concurrently.
 */
export declare class AgentQueue {
    private queues;
    private running;
    enqueue<T>(agent: string, fn: () => Promise<T>): Promise<T>;
    size(agent: string): number;
    private process;
}
