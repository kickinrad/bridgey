import * as http from 'node:http';

export interface WhoisIdentity {
  node: string;
  user: string;
}

type WhoisResponse = {
  Node: { Name: string };
  UserProfile: { LoginName: string };
};

const DEFAULT_SOCK = '/run/tailscale/tailscaled.sock';

/**
 * Query the Tailscale local API for the identity of the peer at addr.
 * Uses HTTP over unix socket to avoid shelling out.
 * Returns null if the peer is unknown (404), the socket is unavailable, or the response is malformed.
 */
export function whoisFromSocket(
  addr: string,
  sockPath: string = DEFAULT_SOCK,
): Promise<WhoisIdentity | null> {
  return new Promise((resolve) => {
    let req: http.ClientRequest;
    try {
      req = http.request(
        {
          socketPath: sockPath,
          host: 'local-tailscaled.sock',
          path: `/localapi/v0/whois?addr=${encodeURIComponent(addr)}`,
          method: 'GET',
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }

          const chunks: (Buffer | string)[] = [];
          res.on('data', (chunk: Buffer | string) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const body = chunks
                .map((c) => (typeof c === 'string' ? c : c.toString('utf8')))
                .join('');
              const parsed = JSON.parse(body) as WhoisResponse;
              resolve({
                node: parsed.Node.Name,
                user: parsed.UserProfile.LoginName,
              });
            } catch {
              resolve(null);
            }
          });
        },
      );
    } catch {
      return resolve(null);
    }

    req.on('error', () => resolve(null));
    req.end();
  });
}
