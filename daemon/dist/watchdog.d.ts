export interface WatchdogArgs {
    config: string;
    pidfile: string;
    maxRestarts: number;
    cooldownMs: number;
}
export declare function buildWatchdogArgs(argv: string[]): WatchdogArgs;
export declare function shouldRestart(exitCode: number | null, restartCount: number, maxRestarts: number): boolean;
export declare function startWatchdog(args: WatchdogArgs): void;
