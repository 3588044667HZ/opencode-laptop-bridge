# OpenCode Laptop Bridge — 交接文档

最后更新：2026-11-03  
维护状态：MVP 已完成并通过 smoke test；本项目后续由新的 agent 继续。

## 0. TL;DR

- 实现位置：`E:\opencode-laptop-bridge`
- 集成契约：`E:\opencode-source\specs\laptop-bridge.md`
- 架构：OpenCode（工作站）→ Tailscale Serve → supergateway（127.0.0.1）→ DesktopCommanderMCP → 笔记本 shell/进程
- 当前暴露工具：`start_process`、`read_process_output`、`interact_with_process`、`force_terminate`、`list_sessions`
- 不做 adb 专用工具；adb、pio、idf.py、openocd 等都通过通用 shell 执行
- 只暴露 Streamable HTTP `/mcp`，Bearer token，Tailscale tailnet 访问
- 绿色便携包已生成：`dist/opencode-laptop-bridge-portable-win32-x64.zip`
- 尚未做真实 OpenCode + Tailscale 端到端测试；尚未部署 serve
- 项目目前**不是 git 仓库**，没有提交历史

## 1. 项目边界

这是独立项目，不是 OpenCode monorepo 的 `packages/*` 包。

OpenCode 主仓库只保留：

- `specs/laptop-bridge.md`：集成契约和 MVP 规格
- `.opencode/memory.md`：长期纪律

OpenCode 的配置示例在 bridge 项目的 `opencode.example.json`。

桥接器通过标准 MCP 协议与 OpenCode 通信，不 import OpenCode 内部源码。OpenCode 的内部重构不应要求同步 bridge 源码；只有公开行为变化时才更新契约和兼容性测试。

## 2. 当前架构

```text
OpenCode (workstation)
  remote MCP server name: laptop
  URL: https://<laptop>.<tailnet>.ts.net/mcp
  Authorization: Bearer <LAPTOP_MCP_TOKEN>
        |
        v
Tailscale Serve (HTTPS, tailnet only)
        |
        v
supergateway 4.2.1 on 127.0.0.1:8765
  - Streamable HTTP, path /mcp
  - API key required
  - only five process tools
        |
        v
@wonderwhy-er/desktop-commander 0.3.1 (stdio)
        |
        v
laptop user session: shell, child processes, USB, adb, local toolchain
```

## 3. 当前状态

### 已完成并验证

- supergateway + DesktopCommander 组合启动成功
- 未认证和错误 token 均返回 401
- 认证后只列出五个工具
- `start_process` 执行 `echo bridge-ok` 成功
- 长任务启动、`read_process_output` 读取、`list_sessions` 查看、`force_terminate` 终止成功
- `interact_with_process` 交互测试成功
- 源项目 smoke test 通过
- 便携包内 smoke test 通过（使用 `dist/.../runtime/node.exe app/scripts/smoke-test.mjs`）
- 便携 zip 已生成：322 MB；解压目录约 345 MB

### 尚未验证

- 真实 OpenCode 工作站通过 Tailscale Serve 调用
- Windows `start.cmd` / Task Scheduler 首次实际运行
- Linux systemd unit 实际启动
- 真实 adb/串口/嵌入式工具链
- GUI、单文件打包
- 多客户端并发、断线重连、长时间后台任务

### 构建产物新鲜度

- 当前 zip 生成于 2026-11-03 19:36。
- 之后源 `opencode.example.json` 增加了 `permission` 字段，因此当前离线 zip 内的示例配置可能较旧。
- 分发前重新运行 `node scripts/package-portable.mjs`。
- `HANDOFF.md` 不会被打进绿色包；它只用于源码仓库交接。

### 当前 Tailscale 状态

- 本机 Tailscale 已安装并连接
- `tailscale serve status`：`No serve config`
- `tailscale funnel status`：`No serve config`
- 尚未执行 `tailscale serve --bg 8765`

## 4. 文件地图

```text
E:\opencode-laptop-bridge\
  package.json                 # 脚本、固定依赖版本
  bun.lock
  README.md                    # 面向使用者的说明
  HANDOFF.md                   # 本文件
  .env.example                 # token 占位符
  .gitignore
  opencode.example.json        # OpenCode remote MCP + 权限示例
  scripts/
    start-bridge.mjs           # 启动 supergateway，管理 token/子进程
    smoke-test.mjs             # 启动桥并做 MCP 端到端测试
    portable-start.mjs         # 绿色版入口，生成/读取 data/token
    package-portable.mjs       # 生成绿色目录和 zip
  deploy/
    tailscale.md               # Tailscale Serve 说明
    security.md                # 威胁模型和 token 轮换
    linux/opencode-laptop-bridge.service
    windows/install-task.ps1
    windows/start-bridge.ps1
    windows/start-hidden.vbs
  dist/
    opencode-laptop-bridge-portable-win32-x64/
    opencode-laptop-bridge-portable-win32-x64.zip
```

OpenCode 主仓库相关文件：

```text
E:\opencode-source\specs\laptop-bridge.md
E:\opencode-source\.opencode\memory.md
```

`dist/` 是构建产物，不是源码真相；修改源码后必须重新打包。

## 5. 固定版本与环境

- Node.js 24.18.0
- Bun 1.3.14
- supergateway 4.2.1
- @wonderwhy-er/desktop-commander 0.3.1
- @modelcontextprotocol/sdk 1.32.2（仅 smoke test/devDependency）

本机注意：

- npm 当前有 ESM/brace-expansion 错误，不要依赖 npm；使用 Bun 安装。
- 首次 `bun install` 可能出现 `EEXIST ... @desktop-commander/telemetry-contract` 警告；复跑后无变化，运行正常。不要因为该警告重建整个项目。
- 网络访问如需代理：`HTTP_PROXY=http://127.0.0.1:10808 HTTPS_PROXY=http://127.0.0.1:10808`。这是本机环境信息，不是必须写入生产配置的内容。
- 绿色包复制的是当前平台的 `process.execPath`（本机为 `D:\nodejs\node.exe`），不能跨平台复制。

## 6. MCP 工具契约

桌面端 raw tool 名（OpenCode 会自动加 `laptop_` 前缀）：

| Raw | OpenCode |
| --- | --- |
| `start_process` | `laptop_start_process` |
| `read_process_output` | `laptop_read_process_output` |
| `interact_with_process` | `laptop_interact_with_process` |
| `force_terminate` | `laptop_force_terminate` |
| `list_sessions` | `laptop_list_sessions` |

重要：

- DesktopCommander 0.3.1 使用 `start_process`，**不是旧文档里的 `execute_command`**。
- `start_process` 必填 `command` 和 `timeout_ms`；可选 `shell`、`verbose_timing`。
- 没有 `cwd` 参数。需要目录时在命令里写平台对应的 `cd ... && ...`。
- 不暴露 filesystem、PDF、config、adb 专用工具。
- 不使用 supergateway 的 `--toolPrefix`，否则会和 OpenCode 的 `laptop_` 前缀叠加。

## 7. 启动与测试

源项目：

```powershell
cd E:\opencode-laptop-bridge
bun install
copy .env.example .env
# 编辑 .env，替换 LAPTOP_MCP_TOKEN
node scripts/start-bridge.mjs
```

测试：

```powershell
node scripts/smoke-test.mjs
```

绿色便携版：

```powershell
node scripts/package-portable.mjs
```

输出：

```text
dist/opencode-laptop-bridge-portable-win32-x64/
dist/opencode-laptop-bridge-portable-win32-x64.zip
```

绿色版首次启动：

```text
Windows: 双击 start.cmd
Linux:   ./start.sh
```

首次启动由 `scripts/portable-start.mjs` 在 `data/token` 生成 token，控制台会打印一次。之后 OpenCode 工作站需要同一个 token。

`start-bridge.mjs` 会用 `process.execPath` 启动 supergateway 和 DesktopCommander，因此绿色版内的 Node runtime 会被子进程复用。

已执行的便携包验证命令：

```powershell
cd dist\opencode-laptop-bridge-portable-win32-x64
.\runtime\node.exe app\scripts\smoke-test.mjs
```

结果：通过。注意这只验证了绿色目录内的核心启动链路，尚未手动验证 `start.cmd` 的首次 token/交互体验。

## 8. OpenCode 配置

示例文件：`E:\opencode-laptop-bridge\opencode.example.json`

关键内容：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "laptop": {
      "type": "remote",
      "url": "https://laptop.example-tailnet.ts.net/mcp",
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

- URL 必须是 Tailscale Serve 暴露的 `/mcp` 地址。
- `{env:LAPTOP_MCP_TOKEN}` 在**工作站**的 OpenCode 进程中读取；不是读取笔记本的 `data/token`。
- `enabled:false` 避免笔记本离线时影响 OpenCode 启动；需要时调用 `mcp(op="enable", name="laptop")`。
- 笔记本长期在线时可改为 `enabled:true`。
- `oauth:false` 是必要的；当前使用静态 Bearer token。
- `timeout` 对编译、烧录、adb 操作可能还要调大。
- `laptop_*` 权限建议先保持 ask，尤其是 `laptop_start_process`。

## 9. Tailscale 部署

笔记本：

```bash
tailscale serve --bg 8765
tailscale serve status
```

工作站验证：

```bash
curl -i https://<laptop>.<tailnet>.ts.net/mcp
```

无 token 应返回 401。带 token 的 MCP 客户端应能初始化并列出五个工具。

禁止：

- `tailscale funnel 8765`
- 绑定 `0.0.0.0`
- 路由器端口转发
- 公网反向代理

当前 `serve` 还未配置；这是新 agent 的首要部署验证任务之一。

## 10. 安全模型

这是通用 shell，不是沙箱。任何拿到 token 且能访问 tailnet 的客户端，等价于拿到笔记本用户的交互登录权限。

必须保持：

- bridge 只监听 `127.0.0.1:8765`
- 只通过 Tailscale Serve 暴露，绝不 Funnel
- Tailscale ACL 只允许工作站访问笔记本
- Bearer token 必须存在
- 以普通用户运行，不 root/Administrator
- Windows 使用登录时 Task Scheduler（交互 session），不要用 Session 0 服务
- Linux 使用用户级 systemd；串口权限按需加 `dialout`/`plugdev`
- token 不写入仓库、argv、日志或 `opencode.json`
- 初始权限保持 ask

已知敏感点：

- 为让 supergateway 校验请求，token 会以 `SUPERGATEWAY_API_KEY` 存在其环境中；通过 bridge 启动的命令可能读取到它。已在 README 和 `deploy/security.md` 说明。
- 日志可能包含命令、路径、输出中的敏感信息。
- `read_process_output` 和 `list_sessions` 当前在示例配置中 allow，属于低风险但仍可能泄露输出/进程信息；可按需改回 ask。

## 11. 已知限制与坑

1. **没有 cwd 字段**
   - DesktopCommander 0.3.1 的 `start_process` 没有 cwd。
   - 使用 `cd /path && command` 或 Windows 对应写法。
   - 若新 agent 要做更干净的目录语义，可以加一个薄适配层，但不要先重写整个 MCP server。

2. **健康检查只检查 gateway**
   - 当前使用 `--healthCheck gateway`。
   - `/healthz` 成功不代表 DesktopCommander 已初始化；真正的健康检查需要带 token 的 MCP 调用。
   - 改进时可以用 `--healthCheck server`，但会产生额外启动/探测行为，需要测试。

3. **快速命令没有数字退出码**
   - DesktopCommander 对快速完成命令返回类似 `Process ... has finished execution`，不是结构化 exit code。
   - 如果 OpenCode 需要精确退出码，需要薄适配层或换实现。

4. **stateful session 生命周期**
   - supergateway 使用 `--stateful`、session timeout 30 分钟。
   - OpenCode 断开后，bridge 会话和后台进程可能结束。
   - 长任务要显式使用 `nohup`/`tmux`/Windows 后台方式，或后续改常驻 session 语义。

5. **token 可能被子进程读取**
   - 见安全模型。不要把它当成仅存在于网络层的秘密。

6. **便携包体积**
   - 322 MB zip，包含 Node runtime、完整 node_modules 和 dev dependency。
   - 后续可做生产依赖裁剪、按平台打包、压缩优化。
   - 不要把 `dist/` 提交到 git。

7. **单文件暂缓**
   - 当前是多进程 Node 栈；真正单文件需要嵌入 runtime/子进程，且要处理 native 依赖和杀软误报。
   - 规格已明确：第一版绿色版优先，单文件后置。

8. **GUI 暂缓**
   - 目标是 Tauri tray/window 壳，不是第二个 bridge。
   - GUI 只管理 start/stop、health、Tailscale URL、日志、token；headless 绿色版必须继续可用。
   - 不要用 Electron。

## 12. OpenCode 仓库当前未提交状态

当前分支：`context-reconciliation`

```text
 M packages/opencode/script/build.ts
 M packages/session-ui/src/components/message-part.tsx
 M script/build-server.ts
?? .opencode/memory.md
?? packages/desktop/dist-lan/
?? specs/laptop-bridge.md
```

说明：

- `packages/session-ui/src/components/message-part.tsx` 是另一个已修复的纯图片消息撤回按钮 bug，不要回退。
- `packages/opencode/script/build.ts` 和 `script/build-server.ts` 是之前构建/目标平台的未提交改动。
- `specs/laptop-bridge.md` 是 bridge 集成契约。
- `.opencode/memory.md` 包含长期纪律。
- `packages/desktop/dist-lan/` 是未提交构建产物。
- 新 agent 不要假设工作区干净；不要一次性 `git add .`。

## 13. 下一步建议

优先级从高到低：

1. **真实端到端验证**
   - 启动 bridge
   - `tailscale serve --bg 8765`
   - 在 OpenCode 工作站配置 `laptop`
   - `mcp enable laptop`
   - 调用 `laptop_start_process` 返回笔记本 hostname
   - 停掉 bridge，确认工具失败且不会回退本地 `shell`

2. **验证绿色版首次启动**
   - 在没有 `.env`、没有 `data/token` 的目录运行 `start.cmd`
   - 确认生成 token、打印 URL、健康检查通过
   - 确认删除目录即可卸载

3. **建立独立 git 仓库**
   - 在 `E:\opencode-laptop-bridge` 初始化仓库
   - 将 `dist/`、`node_modules/`、`data/token`、`.env`、`logs/` 加入 `.gitignore`
   - 提交源码和 HANDOFF.md
   - 不要提交当前生成的 322 MB zip

4. **提高健康检查和错误语义**
   - 评估 `--healthCheck server`
   - 评估 `start_process` 退出码适配
   - 评估 cwd 适配

5. **轻量 GUI**
   - 单开 Tauri 工程，调用现有绿色版核心
   - 先做 tray + 启停 + 状态 + 复制 token/URL
   - 不改变 MCP 数据路径

6. **单文件评估**
   - 只有在绿色版 + GUI 仍不满足分发需求时再做
   - 先验证 Bun compile / Node SEA 对 DesktopCommander 子进程和 native 依赖的兼容性

## 14. 新 agent 快速检查清单

- [ ] 读 `E:\opencode-source\specs\laptop-bridge.md`
- [ ] 读本文件
- [ ] 确认 `E:\opencode-laptop-bridge` 不是 git 仓库，先决定是否 init
- [ ] 不修改 OpenCode 主仓库的无关未提交文件
- [ ] 不把 token、`.env`、`data/token`、`dist` 提交
- [ ] 不添加 adb 专用工具
- [ ] 不绑定 `0.0.0.0`
- [ ] 不使用 Tailscale Funnel
- [ ] 不把 `execute_command` 当成当前工具名
- [ ] 先跑 `node scripts/smoke-test.mjs`
- [ ] 再跑绿色目录内的 smoke test
- [ ] 再做 Tailscale + OpenCode 端到端

## 15. 已验证命令与输出摘要

源项目 smoke：

```text
healthz ok
unauthenticated MCP request rejected with 401
invalid-token MCP request rejected with 401
tools: force_terminate, interact_with_process, list_sessions, read_process_output, start_process
start_process echo output: bridge-ok
long-running process started
read_process_output: tick-1
list_sessions contains pid
force_terminate: Successfully initiated termination
interact_with_process: got:hello
smoke test passed
```

绿色目录内 smoke：

```powershell
cd E:\opencode-laptop-bridge\dist\opencode-laptop-bridge-portable-win32-x64
.\runtime\node.exe app\scripts\smoke-test.mjs
```

结果：同样通过。

## 16. 不要做的事

- 不要把 bridge 放进 `packages/opencode` 或依赖 OpenCode 内部模块。
- 不要用源码同步的方式解决协议兼容；用 MCP 契约和兼容性测试。
- 不要把 DesktopCommander 的文件系统工具、PDF 工具一并暴露；MVP 只暴露五个进程工具。
- 不要为了让模型“方便”而扩大权限到 allow-all。
- 不要把 Windows bridge 改成服务模式；USB/adb 需要用户会话。
- 不要在未验证的情况下声称 Tailscale/OpenCode 端到端已通过。
