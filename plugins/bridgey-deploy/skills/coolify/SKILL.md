---
name: coolify
description: Manage agent deployments on Coolify — create services, configure env vars, deploy, view logs, and health checks via the Coolify API. Use when the user mentions Coolify, wants to deploy via Coolify, or manage Coolify services.
triggers:
  - coolify
  - coolify deploy
  - coolify status
  - coolify logs
  - deploy via coolify
  - manage coolify
---

# Coolify Integration

Manage agent deployments on Coolify via the API (v1). All connection details are stored in `bridgey-deploy.config.json`.

## First-Use Setup

If `bridgey-deploy.config.json` doesn't exist or is missing Coolify fields, ask the user:

1. **Coolify URL** — e.g., `https://coolify.example.com` (the Coolify dashboard URL)
2. **API token** — generated from Coolify dashboard -> Settings -> API Tokens

Store in `bridgey-deploy.config.json`:

```json
{
  "coolify": {
    "url": "https://coolify.example.com",
    "token": "stored-via-pass"
  }
}
```

**Security:** The API token should be fetched via `pass` — never hardcoded. Suggest: `pass insert coolify/api-token`

## API Reference

Base URL: `{coolify_url}/api/v1`
Auth header: `Authorization: Bearer {token}`

### Common Operations

#### List servers
```bash
curl -sf -H "Authorization: Bearer {token}" {coolify_url}/api/v1/servers | jq '.[] | {uuid, name, ip}'
```

#### List services on a server
```bash
curl -sf -H "Authorization: Bearer {token}" {coolify_url}/api/v1/servers/{server_uuid}/resources | jq '.'
```

#### Create a new service (Docker Compose)
```bash
curl -sf -X POST -H "Authorization: Bearer {token}" -H "Content-Type: application/json" \
  {coolify_url}/api/v1/services \
  -d '{
    "type": "docker-compose",
    "name": "agent-{name}",
    "server_uuid": "{server_uuid}",
    "project_uuid": "{project_uuid}",
    "environment_name": "production",
    "docker_compose_raw": "<base64-encoded docker-compose.yml>"
  }'
```

#### Update environment variables
```bash
curl -sf -X PATCH -H "Authorization: Bearer {token}" -H "Content-Type: application/json" \
  {coolify_url}/api/v1/services/{service_uuid}/envs \
  -d '{"key": "BRIDGEY_AGENT_NAME", "value": "{name}", "is_build_time": false}'
```

#### Deploy a service
```bash
curl -sf -X POST -H "Authorization: Bearer {token}" \
  {coolify_url}/api/v1/services/{service_uuid}/deploy
```

#### Get service status
```bash
curl -sf -H "Authorization: Bearer {token}" \
  {coolify_url}/api/v1/services/{service_uuid} | jq '{status, name}'
```

#### View deployment logs
```bash
curl -sf -H "Authorization: Bearer {token}" \
  {coolify_url}/api/v1/services/{service_uuid}/logs | jq '.'
```

## Workflow: Deploy New Agent via Coolify

1. List servers -> ask user which one
2. List projects -> ask user which one (or create new)
3. Read docker-compose template from `${CLAUDE_PLUGIN_ROOT}/skills/deploy/references/docker-compose.yml`
4. Replace placeholders with agent name
5. Create service via API
6. Set environment variables (BRIDGEY_AGENT_NAME, BRIDGEY_BIND, BRIDGEY_PORT, plus any agent-specific vars)
7. Deploy
8. Wait for healthy status
9. Store Coolify service UUID in `bridgey-deploy.config.json`

## Workflow: Update Existing Deployment

1. Read `bridgey-deploy.config.json` for service UUID
2. Update env vars or docker-compose as needed
3. Redeploy
4. Verify healthy

## Workflow: Health Check

1. Get service status via API
2. Check container health via SSH (if Tailscale available)
3. Check bridgey daemon via `/.well-known/agent.json`
4. Report combined status

## Important

- All API calls should use `curl` with `-sf` (silent, fail on HTTP errors)
- Parse responses with `jq`
- Store service UUIDs in `bridgey-deploy.config.json` for future reference
- Never expose the API token in logs or output — use `pass` for retrieval
