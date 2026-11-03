#!/usr/bin/env node
import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const root = path.resolve(import.meta.dirname, "..", "..")
const data = path.join(root, "data")
const tokenFile = path.join(data, "token")
mkdirSync(data, { recursive: true })

const fromEnv = process.env.LAPTOP_MCP_TOKEN?.trim()
let token = fromEnv
if (!token && existsSync(tokenFile)) token = readFileSync(tokenFile, "utf8").trim()
if (!token) {
  token = randomBytes(32).toString("hex")
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 })
  try {
    chmodSync(tokenFile, 0o600)
  } catch {
    // Windows ACLs are the effective permission boundary there.
  }
  console.log(`Generated bridge token at ${tokenFile}`)
  console.log(`Token: ${token}`)
  console.log("Store this token in the workstation's LAPTOP_MCP_TOKEN environment variable.")
}

process.env.LAPTOP_MCP_TOKEN = token
await import(pathToFileURL(path.join(root, "app", "scripts", "start-bridge.mjs")).href)
