import { describe, it, expect } from 'vitest';
import { AgentQueue } from '../queue.js';
describe('AgentQueue', () => {
    it('processes tasks sequentially per agent', async () => {
        const queue = new AgentQueue();
        const order = [];
        const task = (name, delayMs) => () => new Promise((resolve) => {
            setTimeout(() => {
                order.push(name);
                resolve(name);
            }, delayMs);
        });
        const results = await Promise.all([
            queue.enqueue('agent-a', task('a1', 30)),
            queue.enqueue('agent-a', task('a2', 10)),
            queue.enqueue('agent-a', task('a3', 10)),
        ]);
        expect(results).toEqual(['a1', 'a2', 'a3']);
        expect(order).toEqual(['a1', 'a2', 'a3']);
    });
    it('processes different agents concurrently', async () => {
        const queue = new AgentQueue();
        const order = [];
        const task = (name, delayMs) => () => new Promise((resolve) => {
            setTimeout(() => {
                order.push(name);
                resolve(name);
            }, delayMs);
        });
        const results = await Promise.all([
            queue.enqueue('agent-a', task('a1', 50)),
            queue.enqueue('agent-b', task('b1', 10)),
        ]);
        expect(results).toEqual(['a1', 'b1']);
        expect(order[0]).toBe('b1');
    });
    it('propagates errors without breaking the queue', async () => {
        const queue = new AgentQueue();
        await expect(queue.enqueue('agent-a', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        const result = await queue.enqueue('agent-a', () => Promise.resolve('ok'));
        expect(result).toBe('ok');
    });
    it('reports queue size', async () => {
        const queue = new AgentQueue();
        expect(queue.size('agent-a')).toBe(0);
        let resolveFirst;
        const blocker = new Promise((r) => { resolveFirst = r; });
        const p1 = queue.enqueue('agent-a', () => blocker.then(() => 'done'));
        const p2 = queue.enqueue('agent-a', () => Promise.resolve('next'));
        expect(queue.size('agent-a')).toBe(1);
        resolveFirst();
        await Promise.all([p1, p2]);
        expect(queue.size('agent-a')).toBe(0);
    });
});
