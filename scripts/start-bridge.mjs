#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"

const ROOT = path.resolve(import.meta.dirname, "..")
const ALLOWED_TOOLS = [
  "start_process",
  "read_process_output",
  "interact_with_process",
  "force_terminate",
  "list_sessions",
]
const DEFAULT_PORT = 8765
const DEFAULT_SESSION_TIMEOUT_MS = 1800000

const envFile = path.join(ROOT, ".env")
if (existsSync(envFile)) process.loadEnvFile(envFile)

const token = process.env.LAPTOP_MCP_TOKEN?.trim()
if (!token) {
  console.error("LAPTOP_MCP_TOKEN is required. Set it in the environment or in .env.")
  process.exit(1)
}

const port = parsePort(process.env.BRIDGE_PORT)

const require = createRequire(import.meta.url)
let supergatewayEntry
let desktopCommanderEntry
try {
  supergatewayEntry = require.resolve("supergateway/dist/index.js")
  desktopCommanderEntry = require.resolve("@wonderwhy-er/desktop-commander/dist/index.js")
} catch (error) {
  console.error(`Cannot resolve bridge dependencies: ${error.message}`)
  console.error("Run `bun install` in the project directory first.")
  process.exit(1)
}

// Keep the token out of the environment inherited by the bridged shell: the
// MCP server child would otherwise let any command read LAPTOP_MCP_TOKEN.
const childEnv = { ...process.env, SUPERGATEWAY_API_KEY: token }
delete childEnv.LAPTOP_MCP_TOKEN
delete childEnv.SUPERGATEWAY_API_KEY_FILE

const stdioCommand = `${quoteArg(process.execPath)} ${quoteArg(desktopCommanderEntry)}`
const args = [
  supergatewayEntry,
  "--stdio",
  stdioCommand,
  "--outputTransport",
  "streamableHttp",
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--streamableHttpPath",
  "/mcp",
  "--stateful",
  "--sessionTimeout",
  String(DEFAULT_SESSION_TIMEOUT_MS),
  ...ALLOWED_TOOLS.flatMap((tool) => ["--tools", tool]),
  "--healthEndpoint",
  "/healthz",
  "--healthCheck",
  "gateway",
  "--logLevel",
  "info",
  "--logFormat",
  "json",
  "--exitWithProcess",
  String(process.pid),
]

console.log(`Laptop bridge listening on http://127.0.0.1:${port}/mcp`)
console.log(`Health check: http://127.0.0.1:${port}/healthz`)

const child = spawn(process.execPath, args, {
  cwd: ROOT,
  env: childEnv,
  // A pipe, not "ignore" or "inherit": supergateway exits on stdin EOF, and a
  // service manager commonly provides /dev/null or no stdin at all.
  stdio: ["pipe", "inherit", "inherit"],
  windowsHide: true,
})

let stopping = false
let exited = false

child.once("error", (error) => {
  console.error(`Failed to start supergateway: ${error.message}`)
  process.exit(1)
})

child.once("exit", (code, signal) => {
  exited = true
  if (stopping) {
    process.exit(0)
  }
  if (signal) {
    console.error(`supergateway exited on signal ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})

process.on("SIGINT", () => stop("SIGINT"))
process.on("SIGTERM", () => stop("SIGTERM"))
if (process.platform !== "win32") process.on("SIGHUP", () => stop("SIGHUP"))

function stop(signal) {
  if (stopping) return
  stopping = true
  if (exited || child.exitCode !== null) {
    process.exit(0)
  }
  console.error(`Stopping laptop bridge (${signal})`)
  if (process.platform === "win32") {
    // Node's child.kill() terminates only supergateway on Windows; taskkill
    // ends the DesktopCommander tree it spawned.
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    if (result.error) console.error(`taskkill failed: ${result.error.message}`)
  } else {
    child.kill(signal)
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL")
    }, 5000).unref()
  }
  setTimeout(() => {
    if (child.exitCode === null) {
      console.error("supergateway did not exit after shutdown; forcing exit")
      child.kill("SIGKILL")
    }
    process.exit(0)
  }, 10000)
}

process.on("exit", () => {
  if (exited || child.exitCode !== null) return
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
  } else {
    try {
      child.kill("SIGKILL")
    } catch {
      // Already gone.
    }
  }
})

function parsePort(value) {
  if (value === undefined || value.trim() === "") return DEFAULT_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`BRIDGE_PORT must be an integer between 1 and 65535, received: ${value}`)
    process.exit(1)
  }
  return port
}

function quoteArg(value) {
  if (!/[\s"]/u.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}
