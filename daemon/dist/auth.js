import { randomBytes } from 'crypto';
import { readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const REGISTRY_DIR = join(homedir(), '.bridgey', 'agents');
/**
 * Validate that the request carries a valid Bearer token matching config.token.
 */
export function validateToken(req, config) {
    const authHeader = req.headers.authorization;
    if (!authHeader)
        return false;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer')
        return false;
    return parts[1] === config.token;
}
/**
 * Check if the request came from a locally-registered agent (same host).
 * Local agents skip token auth.
 */
export function isLocalAgent(req, registryDir = REGISTRY_DIR) {
    const remoteAddr = req.ip;
    if (!remoteAddr)
        return false;
    // Only consider loopback addresses as local
    const localAddrs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (!localAddrs.includes(remoteAddr))
        return false;
    // Verify there are registered local agents
    try {
        const files = readdirSync(registryDir).filter((f) => f.endsWith('.json'));
        return files.length > 0;
    }
    catch {
        return false;
    }
}
/**
 * Generate a new bridgey token: brg_ + 32 random hex characters.
 */
export function generateToken() {
    return 'brg_' + randomBytes(16).toString('hex');
}
