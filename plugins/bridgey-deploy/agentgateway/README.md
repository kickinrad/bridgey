# agentgateway deployment

Agentgateway v1.1.0 sits in the Coolify service network and exposes a single MCP endpoint (`http://agentgateway:8090/mcp`) that fans out to upstream MCP servers. Auth is a two-layer model: agentgateway enforces a coarse Tailscale gate (extAuthz whois over `/run/tailscale/tailscaled.sock` — any non-tailnet caller gets rejected before reaching any tool); the bridgey daemon handles fine-grained per-user/node allowlists on inbound agent messages. Persona containers reach the fleet endpoint via `BRIDGEY_AGENTGATEWAY_URL=http://agentgateway:8090/mcp`; the `claude mcp add` call in `entrypoint.sh` registers it as `mcp-fleet` in each session's MCP config at startup.

## Deploy steps (run by X1 on cloud)

1. Copy `config.yaml` to `/data/coolify/services/jgcko8w0o4gwoocs0cks8swo/agentgateway/config.yaml`
2. Build `mealie-mcp:latest` locally on cloud (Front A's Dockerfile)
3. Apply `compose.snippet.yaml` into the existing Coolify compose
4. `docker compose up -d agentgateway mealie-mcp`
5. Restart all 5 persona containers to pick up the new env vars

## Health check

Agentgateway readiness endpoint (port 15021, separate from the MCP listener):

```bash
curl -s http://agentgateway:15021/healthz/ready
# → "ready" on success
```

The `bridgey:status` MCP tool surfaces this automatically via `BRIDGEY_AGENTGATEWAY_URL`.

## Validation

The `--validate` flag is not documented for agentgateway 1.1.0. Config correctness is verified by running the container and checking it starts without error:

```bash
docker run --rm \
  -v "$PWD/agentgateway/config.yaml:/config.yaml:ro" \
  -v "/run/tailscale/tailscaled.sock:/run/tailscale/tailscaled.sock:ro" \
  ghcr.io/agentgateway/agentgateway:1.1.0 --config /config.yaml
```
