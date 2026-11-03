# Security Notes and Threat Model

The Laptop Bridge exposes a generic shell on the laptop to OpenCode running on
the workstation. It is intentionally small, and it is not a sandbox.

## Core property

Any client that can reach the bridge with a valid token can run arbitrary
commands with the laptop user's full authority: read and write files, use saved
credentials, reach local network services, control USB/serial devices, and run
`adb` against already-authorized phones. Treat the bridge as equivalent to
handing the MCP client an interactive login session on the laptop.

## Trust path

```text
OpenCode on workstation
  -> tailnet (Tailscale ACL)
  -> Tailscale Serve HTTPS (TLS, tailnet only)
  -> supergateway on 127.0.0.1:8765 (bearer token)
  -> DesktopCommanderMCP (stdio)
  -> laptop user session (shell, child processes, adb, toolchain)
```

Each layer is independent. Tailnet membership does not replace the token, and
the token does not replace the Tailscale ACL.

## Threats and controls

| Threat | Control |
| --- | --- |
| Public internet scanning or accidental LAN exposure | Bridge binds `127.0.0.1` only. Publish through Tailscale Serve only. Never use Funnel, `0.0.0.0`, router port forwarding, or a public reverse proxy. |
| Another tailnet member reaches the bridge | Tailscale ACL grants only the workstation identity/device to the laptop on `tcp:443`. Do not grant `autogroup:member`. |
| Token guessed or reused | Long random bearer token (at least 32 random bytes), required on every MCP request. Missing or invalid tokens return 401. |
| Token leaked through the repository or task arguments | Token lives in a user-protected file or user environment file, never in git, task arguments, command lines, or `opencode.json`. OpenCode uses `{env:LAPTOP_MCP_TOKEN}`. |
| Compromised workstation or prompt injection | Keep OpenCode permission for `laptop_*` at `ask`. Review commands before approval. The bridge cannot distinguish a legitimate model request from an injected one. |
| Privilege escalation | Run as the normal user with `RunLevel Limited` on Windows and a user-level systemd unit on Linux. Never run as root/Administrator and never install a privileged service. |
| USB/adb invisible to the bridge | Run on Windows as an interactive logon task in the user's session. A Session 0 service cannot see user USB devices or adb authorization state. |
| Token or command leakage in logs | Logs can contain command text and output. Restrict log access and rotate on suspected exposure. |
| Supply chain compromise | Versions are pinned (`supergateway` 4.2.1, `@wonderwhy-er/desktop-commander` 0.3.1). Install from the trusted registry and keep the lockfile reviewed. |

## Required controls

- Bind the bridge to `127.0.0.1`; never `0.0.0.0`.
- Expose it only through Tailscale Serve; never Tailscale Funnel.
- Restrict it with a Tailscale ACL to the workstation.
- Require the bearer token even inside the tailnet.
- Run as the normal user, not root/Administrator.
- Keep the token out of the repository and out of task/service arguments.
- Keep the bridge and Tailscale current, with pinned bridge dependencies.
- Keep OpenCode's `laptop_*` permission at `ask` initially.

## Windows: user-session requirement

Use `deploy/windows/install-task.ps1`, which registers an **at-logon** task with
`LogonType Interactive` and `RunLevel Limited`.

- Do not convert it to a Windows service.
- Do not select "Run whether user is logged on or not"; that uses a
  non-interactive session, where USB devices and adb are typically unavailable.
- The task starts `deploy\windows\start-hidden.vbs`, which runs
  `powershell.exe -File deploy\windows\start-bridge.ps1` with working
  directory `E:\opencode-laptop-bridge`.
- The wrapper reads `%USERPROFILE%\.config\opencode-laptop-bridge\token`,
  validates it is non-empty, and sets `LAPTOP_MCP_TOKEN` in the bridge process
  environment. The token never appears in the task action or its arguments.

Protect the token file so only the current user can read it:

```powershell
icacls "$env:USERPROFILE\.config\opencode-laptop-bridge\token" /inheritance:r /grant:r "$($env:USERNAME):(F)"
```

## Linux: user unit

Install `deploy/linux/opencode-laptop-bridge.service` as a systemd **user**
unit. Do not add `User=root` or install it system-wide. The environment file
`~/.config/opencode-laptop-bridge/env` must be mode `600`.

Grant `dialout`/`plugdev` only when serial devices are actually needed; those
groups already grant device access to the account the bridge runs as.

## Audit

- supergateway emits JSON logs to stdout/stderr and exposes `/healthz`.
- Under Task Scheduler, stdout/stderr are not retained by default. Capture them
  if you need a Windows audit trail, for example by running the wrapper under a
  logging host or redirecting output to a protected file.
- DesktopCommander's process tools are not a tamper-proof audit log. For
  durable records, enable OS-level process auditing:
  - Windows: Task Scheduler history, PowerShell script block logging, Sysmon,
    or equivalent process-creation auditing.
  - Linux: `journald` plus `auditd` `execve` rules.
- Protect logs: they may contain command text, paths, and output that include
  secrets.

## Token handling and rotation

The token is a network boundary secret, not a local security boundary. Any
process running as the same user (and local administrators/root) can read the
token file or process environment. Treat a compromised user session as a
compromised token.

Rotate the token when it may have leaked, when the workstation changes, or when
the laptop is lost or repaired.

Windows (PowerShell):

```powershell
$dir = Join-Path $env:USERPROFILE ".config\opencode-laptop-bridge"
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
[Convert]::ToBase64String($bytes) | Set-Content -NoNewline -LiteralPath (Join-Path $dir "token")
icacls (Join-Path $dir "token") /inheritance:r /grant:r "$($env:USERNAME):(F)"
Stop-ScheduledTask -TaskPath "\" -TaskName "OpenCodeLaptopBridge" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskPath "\" -TaskName "OpenCodeLaptopBridge"
```

Linux:

```bash
new_token="$(openssl rand -base64 48 | tr -d '\n')"
umask 077
printf 'LAPTOP_MCP_TOKEN=%s\nBRIDGE_PORT=8765\n' "$new_token" \
  > ~/.config/opencode-laptop-bridge/env
chmod 600 ~/.config/opencode-laptop-bridge/env
systemctl --user restart opencode-laptop-bridge.service
unset new_token
```

Then update `LAPTOP_MCP_TOKEN` in the environment that starts OpenCode on the
workstation and restart OpenCode. Verify that the old token returns `401` and
the new token returns `200`.

## Incident response

1. Stop the bridge: disable the scheduled task or run
   `systemctl --user disable --now opencode-laptop-bridge.service`.
2. Remove network exposure: `tailscale serve reset` and confirm
   `tailscale funnel status` shows no Funnel configuration.
3. Rotate the token and update the workstation environment.
4. Remove or restrict the affected device in the tailnet, and review ACLs.
5. Review bridge, Task Scheduler, journald, and OS audit logs.
6. If unauthorized command execution is suspected, treat the laptop user
   session as compromised and investigate accordingly.

## Residual risks

- No sandbox: destructive commands are possible within the user's authority.
- No bridge-level command approval or policy engine; approval relies on OpenCode.
- No multi-user tenancy and no per-command rate limiting.
- Prompt injection and a compromised workstation remain the primary paths to
  abuse.
- Local malware running as the same user can read the token and issue commands
  directly over the tailnet.
- The bridge keeps the token in the gateway environment as
  `SUPERGATEWAY_API_KEY`, so commands it starts can read it. Treat command
  output and logs as potentially sensitive.
