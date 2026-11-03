#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"

const root = path.resolve(import.meta.dirname, "..")
const name = `opencode-laptop-bridge-portable-${process.platform}-${process.arch}`
const dist = path.join(root, "dist")
const out = path.join(dist, name)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
mkdirSync(path.join(out, "app"), { recursive: true })
mkdirSync(path.join(out, "runtime"), { recursive: true })
mkdirSync(path.join(out, "data"), { recursive: true })
mkdirSync(path.join(out, "logs"), { recursive: true })

for (const file of ["package.json", "README.md", ".env.example", "opencode.example.json"]) {
  if (existsSync(path.join(root, file))) cpSync(path.join(root, file), path.join(out, "app", file))
}
for (const directory of ["scripts", "deploy", "node_modules"]) {
  if (existsSync(path.join(root, directory))) cpSync(path.join(root, directory), path.join(out, "app", directory), { recursive: true })
}

const nodeName = process.platform === "win32" ? "node.exe" : "node"
const nodeTarget = path.join(out, "runtime", nodeName)
cpSync(process.execPath, nodeTarget)
if (process.platform !== "win32") chmodSync(nodeTarget, 0o755)

writeFileSync(
  path.join(out, "start.cmd"),
  [
    "@echo off",
    "setlocal",
    "set \"ROOT=%~dp0\"",
    "if not exist \"%ROOT%data\" mkdir \"%ROOT%data\"",
    "\"%ROOT%runtime\node.exe\" \"%ROOT%app\scripts\portable-start.mjs\"",
    "if errorlevel 1 pause",
    "endlocal",
    "",
  ].join("\r\n"),
)

const startSh = path.join(out, "start.sh")
writeFileSync(
  startSh,
  [
    "#!/usr/bin/env sh",
    "set -eu",
    "ROOT=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "mkdir -p \"$ROOT/data\"",
    "exec \"$ROOT/runtime/node\" \"$ROOT/app/scripts/portable-start.mjs\"",
    "",
  ].join("\n"),
)
chmodSync(startSh, 0o755)

writeFileSync(
  path.join(out, "README-PORTABLE.txt"),
  [
    "OpenCode Laptop Bridge - portable",
    "",
    "1. 双击 start.cmd（Windows）或执行 ./start.sh（Linux）。",
    "2. 首次启动会在 data/token 生成 token；控制台会打印 token。",
    "3. 在笔记本上执行: tailscale serve --bg 8765",
    "4. 在 OpenCode 配置中使用:",
    "   https://<laptop>.<tailnet>.ts.net/mcp",
    "   Authorization: Bearer <data/token 的内容>",
    "5. 退出时关闭窗口，或在终端按 Ctrl+C。",
    "",
    "不写注册表，不需要管理员权限；删除整个目录即可卸载。",
    "Tailscale 需要单独安装并登录。bridge 只监听 127.0.0.1。",
    "",
  ].join("\r\n"),
)

const zip = path.join(dist, `${name}.zip`)
const tar = process.platform === "win32" ? "tar.exe" : "tar"
const tarArgs = process.platform === "win32"
  ? ["-a", "-c", "-f", `${name}.zip`, name]
  : ["-czf", `${name}.zip`, name]
const result = spawnSync(tar, tarArgs, { cwd: dist, stdio: "inherit" })
if (result.error) {
  console.error(`Portable directory created, but archive failed: ${result.error.message}`)
  process.exitCode = 1
} else if (result.status !== 0) {
  console.error(`Portable directory created, but archive exited with ${result.status}`)
  process.exitCode = 1
} else {
  console.log(`Portable directory: ${out}`)
  console.log(`Archive: ${zip}`)
}
