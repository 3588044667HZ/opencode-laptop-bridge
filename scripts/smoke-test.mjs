#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const ROOT = path.resolve(import.meta.dirname, "..")
const ALLOWED_TOOLS = [
  "start_process",
  "read_process_output",
  "interact_with_process",
  "force_terminate",
  "list_sessions",
]
const TOKEN = `smoke-${randomUUID()}`
const READY_TIMEOUT_MS = 60000
const CALL_TIMEOUT_MS = 60000

const port = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
let bridge
let client
let stderr = ""
let stdout = ""
let tempDir

try {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "laptop-bridge-smoke-"))
  bridge = spawn(process.execPath, [path.join(ROOT, "scripts", "start-bridge.mjs")], {
    cwd: ROOT,
    env: { ...process.env, LAPTOP_MCP_TOKEN: TOKEN, BRIDGE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  bridge.stdout.on("data", (chunk) => {
    stdout += chunk.toString()
  })
  bridge.stderr.on("data", (chunk) => {
    stderr += chunk.toString()
  })

  await waitForHealth()
  console.log(`healthz ok on ${baseUrl}/healthz`)

  const unauthorized = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "unauthorized-probe", version: "0.1.0" },
      },
    }),
    signal: AbortSignal.timeout(10000),
  })
  assertEqual(unauthorized.status, 401, "unauthenticated MCP request status")
  console.log("unauthenticated MCP request rejected with 401")

  const invalid = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer definitely-wrong-token",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }),
    signal: AbortSignal.timeout(10000),
  })
  assertEqual(invalid.status, 401, "invalid-token MCP request status")
  console.log("invalid-token MCP request rejected with 401")

  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  })
  client = new Client({ name: "laptop-bridge-smoke", version: "0.1.0" })
  await client.connect(transport)
  console.log(`connected with MCP SDK (session ${transport.sessionId ?? "none"})`)

  const listed = await client.listTools(undefined, { timeout: CALL_TIMEOUT_MS })
  const names = listed.tools.map((tool) => tool.name).sort()
  assertEqual(JSON.stringify(names), JSON.stringify([...ALLOWED_TOOLS].sort()), "tool list")
  console.log(`tools: ${names.join(", ")}`)

  const echo = await callTool("start_process", { command: "echo bridge-ok", timeout_ms: 10000 })
  assertIncludes(echo, "bridge-ok", "one-shot command output")
  assertIncludes(echo, "finished execution", "one-shot completion state")
  console.log(`start_process echo output: ${lineWith(echo, "bridge-ok")}`)
  console.log(`start_process completion: ${lineWith(echo, "finished execution")}`)

  const longScript = path.join(tempDir, "long-running.mjs")
  await writeFile(
    longScript,
    [
      'console.log("long-start")',
      "let n = 0",
      'setInterval(() => console.log(`tick-${++n}`), 200)',
      "",
    ].join("\n"),
  )
  const longStart = await callTool("start_process", {
    command: `${quoteArg(process.execPath)} ${quoteArg(longScript)}`,
    timeout_ms: 1500,
  })
  const longPid = extractPid(longStart)
  assertIncludes(longStart, "long-start", "long-running process initial output")
  console.log(`long-running process started: pid=${longPid}`)

  const longRead = await callTool("read_process_output", { pid: longPid, timeout_ms: 3000 })
  assertMatches(longRead, /tick-\d+/, "read_process_output output")
  console.log(`read_process_output: ${lineWith(longRead, "tick-")}`)

  const sessions = await callTool("list_sessions", {})
  assertIncludes(sessions, String(longPid), "list_sessions output")
  console.log(`list_sessions contains pid ${longPid}`)

  const terminated = await callTool("force_terminate", { pid: longPid })
  assertNotError(terminated, "force_terminate")
  console.log(`force_terminate: ${firstLine(terminated)}`)
  await waitForSessionGone(longPid)

  const interactiveScript = path.join(tempDir, "interactive.mjs")
  await writeFile(
    interactiveScript,
    [
      'process.stdout.write("> ")',
      'process.stdin.setEncoding("utf8")',
      'let buffer = ""',
      'process.stdin.on("data", (chunk) => {',
      "  buffer += chunk",
      '  let index = buffer.indexOf("\\n")',
      "  while (index >= 0) {",
      '    const line = buffer.slice(0, index).trim()',
      "    buffer = buffer.slice(index + 1)",
      '    if (line === "quit") process.exit(0)',
      '    process.stdout.write(`got:${line}\\n> `)',
      '    index = buffer.indexOf("\\n")',
      "  }",
      "})",
      "",
    ].join("\n"),
  )
  const interactiveStart = await callTool("start_process", {
    command: `${quoteArg(process.execPath)} ${quoteArg(interactiveScript)}`,
    timeout_ms: 3000,
  })
  const interactivePid = extractPid(interactiveStart)
  const interaction = await callTool("interact_with_process", {
    pid: interactivePid,
    input: "hello\n",
    timeout_ms: 10000,
    wait_for_prompt: true,
  })
  assertIncludes(interaction, "got:hello", "interactive process output")
  console.log(`interact_with_process: ${lineWith(interaction, "got:hello")}`)
  await callTool("force_terminate", { pid: interactivePid })

  console.log("smoke test passed")
} catch (error) {
  console.error(`smoke test failed: ${error.message}`)
  if (stdout.trim()) console.error(`--- bridge stdout ---\n${stdout.trim()}`)
  if (stderr.trim()) console.error(`--- bridge stderr ---\n${stderr.trim()}`)
  process.exitCode = 1
} finally {
  try {
    await client?.close()
  } catch {
    // Session may already be gone.
  }
  await stopBridge()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
}

async function waitForHealth() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (bridge.exitCode !== null) {
      throw new Error(`bridge exited before becoming healthy (code ${bridge.exitCode})`)
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await delay(250)
  }
  throw new Error(`timed out waiting for ${baseUrl}/healthz`)
}

async function callTool(name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: CALL_TIMEOUT_MS,
  })
  const text = (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
  if (result.isError) throw new Error(`${name} failed: ${text}`)
  return text
}

async function waitForSessionGone(pid) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const sessions = await callTool("list_sessions", {})
    if (!sessions.includes(String(pid))) return
    await delay(250)
  }
  throw new Error(`session ${pid} was still listed after force_terminate`)
}

async function stopBridge() {
  if (!bridge || bridge.exitCode !== null) return
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(bridge.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    return
  }
  bridge.kill("SIGTERM")
  const deadline = Date.now() + 8000
  while (bridge.exitCode === null && Date.now() < deadline) await delay(100)
  if (bridge.exitCode === null) bridge.kill("SIGKILL")
}

async function getFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  return port
}

function extractPid(text) {
  const match = /PID\s+(-?\d+)/.exec(text)
  if (!match) throw new Error(`could not find a PID in tool output: ${text}`)
  return Number(match[1])
}

function quoteArg(value) {
  if (!/[\s"]/u.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

function firstLine(text) {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "(empty)"
}

function lineWith(text, needle) {
  return text.split(/\r?\n/).find((line) => line.includes(needle)) ?? "(not found)"
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`)
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) throw new Error(`${label}: missing "${expected}" in: ${text}`)
}

function assertMatches(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: ${pattern} did not match: ${text}`)
}

function assertNotError(result, label) {
  if (/^Error:/m.test(result)) throw new Error(`${label} returned an error: ${result}`)
}
