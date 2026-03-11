import { mkdirSync, writeFileSync, unlinkSync, readdirSync, readFileSync, watch } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const REGISTRY_DIR = join(homedir(), '.bridgey', 'agents');
function ensureDir() {
    mkdirSync(REGISTRY_DIR, { recursive: true });
}
/**
 * Register a local agent by writing a JSON file to the registry directory.
 */
export function register(agent) {
    ensureDir();
    const filePath = join(REGISTRY_DIR, `${agent.name}.json`);
    writeFileSync(filePath, JSON.stringify(agent, null, 2), 'utf-8');
}
/**
 * Unregister a local agent by removing its JSON file.
 */
export function unregister(name) {
    const filePath = join(REGISTRY_DIR, `${name}.json`);
    try {
        unlinkSync(filePath);
    }
    catch {
        // File may not exist — that's fine
    }
}
/**
 * Check if a process with the given PID is alive.
 */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * List all locally-registered agents. Removes stale entries whose PIDs are no longer alive.
 */
export function listLocal() {
    ensureDir();
    const agents = [];
    let files;
    try {
        files = readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.json'));
    }
    catch {
        return agents;
    }
    for (const file of files) {
        const filePath = join(REGISTRY_DIR, file);
        try {
            const content = readFileSync(filePath, 'utf-8');
            const agent = JSON.parse(content);
            if (!isProcessAlive(agent.pid)) {
                // Stale entry — remove it
                try {
                    unlinkSync(filePath);
                }
                catch {
                    // ignore cleanup errors
                }
                continue;
            }
            agents.push(agent);
        }
        catch {
            // Malformed file — skip
        }
    }
    return agents;
}
/**
 * Watch the registry directory for changes and invoke callback when agents are added/removed.
 */
export function watchRegistry(callback) {
    ensureDir();
    try {
        watch(REGISTRY_DIR, { persistent: false }, (_eventType, filename) => {
            if (filename && filename.endsWith('.json')) {
                callback();
            }
        });
    }
    catch {
        // If watch fails (e.g., platform limitations), silently degrade
    }
}
