import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const INBOX_DIRNAME = '.inbox';
const DEFAULT_MAX_BYTES = 25_000_000; // 25 MB — generous for phone photos, guards against abuse

type LookupFn = (host: string) => Promise<{ address: string }[]>;

const defaultLookup: LookupFn = (host) => lookup(host, { all: true });

/**
 * Reduce an attachment name to a safe filename: basename only (no path
 * traversal), and only filesystem-safe characters.
 */
export function safeAttachmentName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.\.+/g, '_');
  return cleaned.length > 0 ? cleaned : 'attachment';
}

/**
 * True if an IP literal is loopback, private, link-local (incl. cloud-metadata
 * 169.254.169.254), CGNAT/Tailscale, ULA, or otherwise not a routable public
 * address. Malformed input is treated as unsafe (fail closed).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) ip = mapped[1];

  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80')) return true; // link-local
    if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
    return false;
  }

  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → unsafe
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT / Tailscale
  return false;
}

/**
 * Validate a remote attachment URL before fetching: require https, resolve the
 * host, and reject if ANY resolved address is private/reserved (defeats SSRF and
 * DNS-rebinding to internal services). Returns the parsed URL or throws.
 */
export async function assertPublicHttpsUrl(
  rawUrl: string,
  opts: { lookupFn?: LookupFn } = {},
): Promise<URL> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') {
    throw new Error(`attachment url must be https, got ${url.protocol}`);
  }
  const lookupFn = opts.lookupFn ?? defaultLookup;
  const results = await lookupFn(url.hostname);
  if (results.length === 0) {
    throw new Error(`attachment host ${url.hostname} did not resolve`);
  }
  for (const r of results) {
    if (isPrivateOrReservedIp(r.address)) {
      throw new Error(`attachment host ${url.hostname} resolves to non-public address ${r.address}`);
    }
  }
  return url;
}

/**
 * Build the prompt handed to `claude -p` for an inbound transport message,
 * appending a list of downloaded attachment paths so the model can open them.
 */
export function buildInboundPrompt(
  sender: string,
  transport: string,
  content: string,
  attachmentPaths: string[],
): string {
  const base = `[Message from ${sender} via ${transport}]\n${content}`;
  if (attachmentPaths.length === 0) return base;
  const list = attachmentPaths.map((p) => `- ${p}`).join('\n');
  return `${base}\n\n[Attachments downloaded to this workspace — open them to view:]\n${list}`;
}

/**
 * Download each inbound attachment into `<workspace>/.inbox/` and return the
 * local file paths. URLs are SSRF-validated (https + public address) before
 * fetching, redirects are not followed, and the byte cap is enforced against
 * the actual downloaded size (not the declared `size`). Oversized, unsafe, or
 * failed attachments are skipped without aborting the rest. The daemon runs
 * `claude -p` with the workspace as cwd, so these paths are directly readable
 * by the cold-spawned session.
 */
export async function downloadInboundAttachments(
  attachments: { name: string; url: string; size: number; type: string }[],
  workspace: string,
  opts: { fetchFn?: typeof fetch; lookupFn?: LookupFn; maxBytes?: number } = {},
): Promise<string[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const inbox = join(workspace, INBOX_DIRNAME);
  const saved: string[] = [];

  for (const att of attachments) {
    if (att.size > maxBytes) continue; // cheap early skip on declared size

    let safeUrl: URL;
    try {
      safeUrl = await assertPublicHttpsUrl(att.url, { lookupFn: opts.lookupFn });
    } catch {
      continue; // unsafe URL — skip (SSRF guard)
    }

    try {
      const res = await fetchFn(safeUrl.toString(), { redirect: 'manual' });
      if (!res.ok) continue; // non-2xx (incl. opaque redirects) — skip
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) continue; // real-size cap, doesn't trust att.size
      await mkdir(inbox, { recursive: true });
      const dest = join(inbox, safeAttachmentName(att.name));
      await writeFile(dest, buf);
      saved.push(dest);
    } catch {
      continue; // a bad fetch shouldn't drop the whole message
    }
  }

  return saved;
}
