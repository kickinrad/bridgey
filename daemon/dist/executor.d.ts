export declare const MAX_MESSAGE_LENGTH = 10000;
export declare const TIMEOUT_MS = 300000;
/**
 * Execute a prompt via `claude -p` safely using spawn (no shell injection possible).
 * Returns the response text, or an error message string on failure.
 */
export declare function executePrompt(message: string, workspace: string, maxTurns: number): Promise<string>;
/**
 * Execute a prompt via `claude -p --output-format stream-json` as an async generator.
 * Yields partial text chunks as they arrive from the streaming output.
 */
export declare function executePromptStreaming(message: string, workspace: string, maxTurns: number): AsyncGenerator<string, void, undefined>;
