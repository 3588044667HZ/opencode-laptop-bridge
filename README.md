# OpenCode 笔记本桥接器（opencode-laptop-bridge）

一个独立的 MCP 桥接服务：把本机（笔记本）的通用 shell 暴露给同一 Tailscale tailnet 内另一台机器上的 OpenCode。

```text
OpenCode（工作站）
  -> https://<laptop>.<tailnet>.ts.net/mcp   （Tailscale Serve，仅 tailnet 内可达）
  -> supergateway 4.2.1 on 127.0.0.1:8765    （Bearer token，工具过滤）
  -> @wonderwhy-er/desktop-commander 0.3.1   （stdio）
  -> 笔记本用户会话中的进程
```

桥接器不是沙箱，也不提供 adb 专用工具。`adb`、`esptool`、`pio`、`idf.py`、`ssh`、`docker` 等命令都通过 `start_process` 当作普通命令执行。

## 特性

- 只监听 `127.0.0.1`，仅通过 Tailscale Serve 暴露，不面向公网
- 使用静态 Bearer token 鉴权，未认证请求返回 401
- 只暴露五个进程管理工具，不暴露文件系统、PDF、配置类工具
- 提供源代码运行方式与 Windows 绿色便携包
- 支持 Windows 登录时任务与 Linux 用户级 systemd 两种常驻方式

## 环境要求

- Node.js 24.x（运行时使用 `node`，不是 Bun）
- Bun 1.x 用于安装依赖（npm 可用时也可以）
- 两台机器都安装并连接 Tailscale，用于远程访问

## 快速开始

```powershell
cd E:\opencode-laptop-bridge
bun install
copy .env.example .env
# 编辑 .env，把占位 token 替换为随机长字符串
node scripts/start-bridge.mjs
```

生成 token：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

```bash
# Linux / macOS
openssl rand -hex 32
```

`.env` 会从项目根目录自动加载；同名真实环境变量同样生效。不要提交 `.env`。

启动后进程保持前台运行，并打印：

```text
Laptop bridge listening on http://127.0.0.1:8765/mcp
Health check: http://127.0.0.1:8765/healthz
```

可选环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LAPTOP_MCP_TOKEN` | 必填 | 客户端必须携带的 Bearer token |
| `BRIDGE_PORT` | `8765` | 回环端口；监听地址固定为 `127.0.0.1` |

## 暴露的工具

只会列出并允许调用以下原始工具名：

| 原始工具 | OpenCode 中的名称 | 用途 |
| --- | --- | --- |
| `start_process` | `laptop_start_process` | 启动命令或交互式进程 |
| `read_process_output` | `laptop_read_process_output` | 继续读取会话输出 |
| `interact_with_process` | `laptop_interact_with_process` | 向会话发送输入 |
| `force_terminate` | `laptop_force_terminate` | 终止会话及其进程树 |
| `list_sessions` | `laptop_list_sessions` | 列出活跃进程会话 |

`start_process` 的参数为 `command` 和 `timeout_ms`，可选 `shell`、`verbose_timing`。DesktopCommander 0.3.1 没有 `cwd` 字段，需要切换目录时请使用 `cd ... && ...`（或对应平台的写法）。

不使用 supergateway 的 `--toolPrefix`，因为 OpenCode 会自动添加 `laptop_` 前缀，两者叠加会导致名称重复。

## 冒烟测试

```powershell
node scripts/smoke-test.mjs
```

测试会在空闲回环端口启动桥接器，等待 `/healthz`，验证：

- 未认证的 MCP 请求返回 401
- 使用 token 和 MCP SDK 可以初始化连接
- 工具列表恰好为上述五个
- `echo bridge-ok` 正常返回
- 长任务可以被读取输出并终止
- 交互式输入正常

## Tailscale Serve 部署

在笔记本上执行：

```bash
tailscale serve --bg 8765
tailscale serve status
```

地址通常为 `https://<laptop>.<tailnet>.ts.net/mcp`。路径会被保留，因此 OpenCode 配置中的 URL 需要带 `/mcp`。

**禁止使用 Tailscale Funnel**：Serve 仅在 tailnet 内可达，Funnel 会把 shell 暴露到公网。请同时用 Tailscale ACL 限制只有工作站身份/设备可以访问该服务。

更多说明见 `deploy/tailscale.md`。

## OpenCode 配置

参考 `opencode.example.json`：

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
  },
  "permission": {
    "laptop_start_process": "ask",
    "laptop_read_process_output": "allow",
    "laptop_interact_with_process": "ask",
    "laptop_force_terminate": "ask",
    "laptop_list_sessions": "allow"
  }
}
```

注意事项：

- `enabled: false` 可避免笔记本离线时影响 OpenCode 启动，需要时用 `mcp(op="enable", name="laptop")` 启用。
- `{env:LAPTOP_MCP_TOKEN}` 在**工作站**的 OpenCode 进程中读取，因此工作站也需要配置同一个 token。
- `oauth: false` 是必要的，当前使用静态 Bearer token。
- 编译、烧录、adb 等操作可能需要更大的 `timeout`。
- 建议 `laptop_*` 权限先保持 `ask`，尤其是 `laptop_start_process`。

## 作为服务常驻运行

### Windows（用户登录时启动，不使用 Session 0 服务）

```powershell
# 首次创建受保护的 token 文件
$dir = Join-Path $env:USERPROFILE ".config\opencode-laptop-bridge"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" |
  Set-Content -NoNewline -LiteralPath (Join-Path $dir "token")
icacls (Join-Path $dir "token") /inheritance:r /grant:r "$($env:USERNAME):(F)"

powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-task.ps1
```

这会注册登录时任务 `OpenCodeLaptopBridge`，在交互式用户会话中依次运行 `start-hidden.vbs` → `start-bridge.ps1`。包装脚本从 `%USERPROFILE%\.config\opencode-laptop-bridge\token` 读取 token，避免 token 出现在任务参数中。日志写入 `logs\bridge.log`（需手动轮转）。

### Linux（用户级 systemd）

```bash
mkdir -p ~/.config/systemd/user
cp deploy/linux/opencode-laptop-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now opencode-laptop-bridge.service
journalctl --user -u opencode-laptop-bridge -f
```

如果项目不在默认路径，请调整 unit 中的 `WorkingDirectory` 和 `ExecStart`。token 可放在 `~/.config/opencode-laptop-bridge/env`（权限 `600`），或放在项目的 `.env` 中。

## 绿色便携包

```powershell
node scripts/package-portable.mjs
```

输出：

```text
dist/opencode-laptop-bridge-portable-win32-x64/
dist/opencode-laptop-bridge-portable-win32-x64.zip
```

便携包包含当前平台的 Node runtime，不能跨平台复制。首次启动时由 `scripts/portable-start.mjs` 在 `data/token` 生成 token 并打印一次，之后工作站需要配置同一个 token。便携包内验证命令：

```powershell
cd dist\opencode-laptop-bridge-portable-win32-x64
.\runtime\node.exe app\scripts\smoke-test.mjs
```

`dist/` 是构建产物，不提交到 git；修改源码后需重新打包。

## 安全须知

- 这个项目的产品形态就是远程执行任意 shell：没有沙箱，没有多用户隔离，也没有超出 DesktopCommander 默认值的命令白名单。
- 能访问 tailnet 且拿到 token 的客户端，等价于拥有笔记本用户的交互登录权限。
- token 使用随机长字符串，不进入仓库、argv、日志或 `opencode.json`。
- 桥接器只绑定 `127.0.0.1`，不要改成 `0.0.0.0`，不要做路由器端口转发或公网反向代理。
- 使用普通用户运行，不要以 root/Administrator 常驻。Windows 使用登录时任务，Linux 使用用户级 systemd。
- 为让 supergateway 校验请求，token 会以 `SUPERGATEWAY_API_KEY` 存在于网关进程中，通过桥接器启动的命令可能读取到它；不要把 token 当作只存在于网络层的秘密。
- 日志可能包含命令、路径和输出中的敏感信息。
- token 泄露后立即轮换并重启桥接器。

更完整的威胁模型和轮换流程见 `deploy/security.md`。

## 目录结构

```text
scripts/
  start-bridge.mjs      # 启动 supergateway，管理 token 与子进程
  smoke-test.mjs        # MCP 端到端冒烟测试
  portable-start.mjs    # 绿色版入口，生成/读取 data/token
  package-portable.mjs  # 生成绿色目录和 zip
deploy/
  tailscale.md          # Tailscale Serve 说明
  security.md           # 威胁模型与 token 轮换
  linux/                # systemd unit
  windows/              # 登录时任务与启动脚本
opencode.example.json   # OpenCode remote MCP 与权限示例
HANDOFF.md              # 项目交接文档（不进入绿色包）
```

## 已知限制

- `start_process` 没有 `cwd` 参数，需在命令中自行 `cd`。
- 健康检查只检查 gateway；`/healthz` 成功不代表 DesktopCommander 已初始化。
- 快速完成的命令不会返回结构化退出码。
- 会话是有状态的，超时 30 分钟；长任务应使用 `nohup`、`tmux` 或 Windows 后台方式。
- 便携包约 322 MB，包含完整 `node_modules` 和 dev dependency。
- GUI 与单文件打包尚未实现。
- 尚未完成真实 OpenCode + Tailscale 端到端验证。

## 相关文档

- `HANDOFF.md`：项目交接、当前状态与后续计划
- `deploy/tailscale.md`：Tailscale Serve 配置
- `deploy/security.md`：安全模型与 token 轮换

## 许可证

本项目采用 [MIT License](LICENSE)。
