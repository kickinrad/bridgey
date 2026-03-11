/**
 * Send an A2A streaming message to a remote agent via SSE.
 * Yields partial text chunks as they arrive.
 * Returns the full concatenated response.
 */
export declare function sendA2AMessageStream(agentUrl: string, token: string, message: string, contextId?: string): AsyncGenerator<string, string, undefined>;
/**
 * Send an A2A message to a remote agent via JSON-RPC 2.0.
 * Retries up to 3 times with exponential backoff on transient failures.
 * Returns the response text, or an error message string on failure.
 */
export declare function sendA2AMessage(agentUrl: string, token: string, message: string, contextId?: string): Promise<string>;
