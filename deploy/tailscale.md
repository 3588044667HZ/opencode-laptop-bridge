# Tailscale Serve

The bridge must only be reachable through the tailnet. Tailscale Serve provides
TLS and tailnet reachability while the bridge itself binds `127.0.0.1`.

## Publish the bridge

On the laptop:

```bash
tailscale serve --bg 8765
tailscale serve status
```

Typical result:

```text
https://<laptop>.<tailnet>.ts.net/ -> http://127.0.0.1:8765
```

The OpenCode endpoint is:

```text
https://<laptop>.<tailnet>.ts.net/mcp
```

`--bg` keeps the serve configuration active in the background. `tailscale
serve status` shows the current mapping; remove it with:

```bash
tailscale serve reset
```

## Requirements

- Laptop and workstation are in the same tailnet.
- The laptop is awake and Tailscale is connected.
- The bridge is already running on `127.0.0.1:8765`.
- Serve is being used; Funnel is not.

## Access control

Use Tailscale ACLs to restrict who can reach the laptop's Serve endpoint. Only
the workstation identity/device that runs OpenCode should be allowed.

Do not use:

```bash
tailscale funnel 8765
```

Funnel exposes the service to the public internet and is outside this MVP.

## Verify from the workstation

```bash
curl -i https://<laptop>.<tailnet>.ts.net/mcp
```

Without a bearer token this should return `401`. A configured MCP client with
`Authorization: Bearer $LAPTOP_MCP_TOKEN` should complete initialization and
list exactly the five process tools.
