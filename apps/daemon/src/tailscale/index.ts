export { scanTailnet, getTailscaleStatus, parseTailscaleStatus, probePeer } from './scanner.js';
export {
  readLocalDaemon,
  registerTailnetAgent,
  removeStaleTailnetAgents,
  listTailnetAgents,
} from './registrar.js';
export { loadConfig as loadTailscaleConfig } from './config.js';
export type { BridgeyTailscaleConfig } from './config.js';
