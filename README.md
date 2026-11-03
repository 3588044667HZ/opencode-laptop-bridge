# OpenCode Laptop Bridge

Standalone MCP bridge that exposes a generic shell on this laptop to OpenCode
running on another machine in the same Tailscale tailnet.

```text
OpenCode (workstation)
  -> https://<laptop>.<tailnet>.ts.net/mcp   (Tailscale Serve, tailnet only)
  -> supergateway 4.2.1 on 127.0.0.1:8765    (bearer token, tool filter)
  -> @wonderwhy-er/desktop-commander 0.3.1   (stdio)
  -> the laptop user's processes
```

The bridge is not a sandbox and it does not add adb-specific tools. `adb`,
`esptool`, `pio`, `idf.py`, `ssh`, `docker`, and similar commands all run as
ordinary commands through `start_process`.

## Requirements

- Node.js 24.x (the bridge runs with `node`, not Bun at runtime)
- Bun 1.x for installation (npm works too where npm itself is healthy)
- Tailscale on both machines for remote access

## Quickstart

```powershell
cd E:\opencode-laptop-bridge
bun install
copy .env.example .env
# Edit .env and replace the placeholder token.
node scripts/start-bridge.mjs
```

Generate a token:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

```bash
# Linux / macOS
openssl rand -hex 32
```

`.env` is loaded automatically from the project root. A real environment
variable with the same name also works; do not commit either one.

The process stays in the foreground and prints:

```text
Laptop bridge listening on http://127.0.0.1:8765/mcp
Health check: http://127.0.0.1:8765/healthz
```

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `LAPTOP_MCP_TOKEN` | required | Bearer token clients must present |
| `BRIDGE_PORT` | `8765` | Loopback port; host is always `127.0.0.1` |

## Exposed tools

Only these raw tool names are listed and callable:

| Raw tool | OpenCode tool | Purpose |
| --- | --- | --- |
| `start_process` | `laptop_start_process` | Start a command or interactive process |
| `read_process_output` | `laptop_read_process_output` | Read more output from a session |
| `interact_with_process` | `laptop_interact_with_process` | Send input to a session |
| `force_terminate` | `laptop_force_terminate` | Terminate a session and its process tree |
| `list_sessions` | `laptop_list_sessions` | List active process sessions |

No filesystem, PDF, config, or adb-specific tools are exposed. `--toolPrefix`
is intentionally not used; OpenCode adds `laptop_` itself.

`start_process` arguments are `command` and `timeout_ms`, with optional
`shell` and `verbose_timing`. There is no `cwd` field in DesktopCommander
0.3.1; use a `cd ... && ...` (or platform-equivalent) command prefix.

## Smoke test

```powershell
node scripts/smoke-test.mjs
```

The smoke test starts the bridge on a free loopback port, waits for
`/healthz`, checks that an unauthenticated MCP request returns 401, connects
with the MCP SDK and the bearer token, asserts exactly the five tools above,
runs `echo bridge-ok`, reads and terminates a long-running process, exercises
interactive input, and tears the bridge down.

## Tailscale Serve

On the laptop:

```bash
tailscale serve --bg 8765
tailscale serve status
```

The URL is normally `https://<laptop>.<tailnet>.ts.net/mcp`. Paths are
preserved, so the OpenCode URL keeps `/mcp`.

Do **not** use Tailscale Funnel. Serve is tailnet-only; Funnel would expose the
shell to the public internet. Restrict access with Tailscale ACLs so only the
workstation identity/device can reach this service.

See `deploy/tailscale.md` for more details.

## OpenCode configuration

`opencode.example.json` contains the remote MCP entry:

```json
{
  "mcp": {
    "laptop": {
      "type": "remote",
      "url": "https://<laptop>.<tailnet>.ts.net/mcp",
      "enabled": false,
      "oauth": false,
      "timeout": 120000,
      "headers": {
        "Authorization": "Bearer {env:LAPTOP_MCP_TOKEN}"
      }
    }
  }
}
```

`enabled: false` avoids a startup failure when the laptop is offline. Enable
the server with the `mcp` tool when needed. `{env:LAPTOP_MCP_TOKEN}` is read
in the OpenCode process on the workstation, so the workstation also needs the
same token in its environment.

Keep the OpenCode permission for `laptop_*` at `ask` initially.

## Running as a service

Windows (user logon, not Session 0):

```powershell
# Create the protected token file once.
$dir = Join-Path $env:USERPROFILE ".config\opencode-laptop-bridge"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" |
  Set-Content -NoNewline -LiteralPath (Join-Path $dir "token")
icacls (Join-Path $dir "token") /inheritance:r /grant:r "$($env:USERNAME):(F)"

powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-task.ps1
```

This registers the at-logon task `OpenCodeLaptopBridge`, which runs
`start-hidden.vbs` -> `start-bridge.ps1` in the interactive user session.
The wrapper reads `%USERPROFILE%\.config\opencode-laptop-bridge\token`, so the
token stays out of task arguments. Logs are written to `logs\bridge.log`
(rotate manually).

Linux (user-level systemd):

```bash
mkdir -p ~/.config/systemd/user
cp deploy/linux/opencode-laptop-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now opencode-laptop-bridge.service
journalctl --user -u opencode-laptop-bridge -f
```

Adjust `WorkingDirectory` and `ExecStart` paths in the unit if the project is
not at the default location. Put the token in
`~/.config/opencode-laptop-bridge/env` with mode `600`, or in the project
`.env`.

## Windows / Linux notes

- Windows: run as the normal logged-in user so USB devices and adb are visible.
  Do not install as a Session 0 service.
- Linux: run as a user service. Add the user to `dialout`/`plugdev` only if
  serial devices actually need it.
- The bridge binds `127.0.0.1` only. Do not change the host to `0.0.0.0`.
- `start_process` commands run with the laptop user's full authority. Treat
  the token like a shell credential.
- The token is not passed in argv. It is present as `SUPERGATEWAY_API_KEY` in
  the gateway process, so commands run through the bridge can read it from
  their environment. The bridge is not a sandbox: treat a bridged shell as a
  login session belonging to the laptop user.

## Security caveats

- Arbitrary remote shell execution is the product. There is no sandbox, no
  command allowlist beyond DesktopCommander's defaults, and no multi-user
  isolation.
- Use a long random token, keep it out of source control, and restrict the
  tailnet path to the workstation device.
- Never expose this port through a public interface, port forwarding, or
  Tailscale Funnel.
- If the token leaks, rotate it and restart the bridge.
