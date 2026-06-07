import fs from 'node:fs'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** @param {NodeJS.CpuInfo[]} cpus */
function cpuTotals(cpus) {
  let idle = 0
  let total = 0
  for (const cpu of cpus) {
    const t = cpu.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

export async function sampleCpuUsagePct() {
  const a = cpuTotals(os.cpus())
  await sleep(180)
  const b = cpuTotals(os.cpus())
  const idleDiff = b.idle - a.idle
  const totalDiff = b.total - a.total
  if (totalDiff <= 0) return null
  return Math.round((1 - idleDiff / totalDiff) * 1000) / 10
}

function readLinuxNetworkBytes() {
  try {
    const text = fs.readFileSync('/proc/net/dev', 'utf8')
    let rx = 0
    let tx = 0
    for (const line of text.split('\n').slice(2)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parts = trimmed.split(/\s+/)
      const name = parts[0].replace(/:$/, '')
      if (name === 'lo') continue
      rx += Number(parts[1]) || 0
      tx += Number(parts[9]) || 0
    }
    return { rx_bytes: rx, tx_bytes: tx }
  } catch {
    return null
  }
}

async function readWindowsNetworkBytes() {
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `$s = Get-NetAdapterStatistics | Where-Object { $_.Name -notmatch 'Loopback' -and $_.InterfaceOperationalStatus -eq 'Up' }; ` +
      `[PSCustomObject]@{ rx = [int64](($s | Measure-Object ReceivedBytes -Sum).Sum); tx = [int64](($s | Measure-Object SentBytes -Sum).Sum) } | ConvertTo-Json -Compress`,
    ], { timeout: 8000, windowsHide: true })
    const data = JSON.parse(stdout.trim())
    return {
      rx_bytes: Number(data.rx) || 0,
      tx_bytes: Number(data.tx) || 0,
    }
  } catch {
    return null
  }
}

/** @returns {Promise<{ rx_bytes: number, tx_bytes: number } | null>} */
async function readNetworkBytesTotal() {
  const platform = os.platform()
  if (platform === 'linux') return readLinuxNetworkBytes()
  if (platform === 'win32') return readWindowsNetworkBytes()
  return null
}

const NETWORK_SAMPLE_MS = 400

export async function sampleNetworkSpeed() {
  const a = await readNetworkBytesTotal()
  if (!a) return null
  await sleep(NETWORK_SAMPLE_MS)
  const b = await readNetworkBytesTotal()
  if (!b) return null
  const elapsedSec = NETWORK_SAMPLE_MS / 1000
  const rxDiff = b.rx_bytes - a.rx_bytes
  const txDiff = b.tx_bytes - a.tx_bytes
  return {
    rx_bytes_per_sec: Math.max(0, Math.round((rxDiff >= 0 ? rxDiff : 0) / elapsedSec)),
    tx_bytes_per_sec: Math.max(0, Math.round((txDiff >= 0 ? txDiff : 0) / elapsedSec)),
  }
}

function formatPlatformLabel(platform) {
  const map = { win32: 'Windows', linux: 'Linux', darwin: 'macOS', freebsd: 'FreeBSD' }
  return map[platform] || platform
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} 天 ${h} 小时`
  if (h > 0) return `${h} 小时 ${m} 分`
  return `${m} 分钟`
}

/**
 * @param {{ cpuUsagePct?: number | null, networkSpeed?: { rx_bytes_per_sec: number, tx_bytes_per_sec: number } | null }} [opts]
 */
export function getSystemMetrics(opts = {}) {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const load = os.loadavg()
  const cpus = os.cpus()
  const regionEnv = String(process.env.CAT_SERVER_REGION || '').trim()
  const speed = opts.networkSpeed ?? null

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    platform_label: formatPlatformLabel(os.platform()),
    arch: os.arch(),
    node_version: process.version,
    uptime_seconds: os.uptime(),
    uptime_label: formatUptime(os.uptime()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    region_label: regionEnv || null,
    memory: {
      total_bytes: totalMem,
      used_bytes: usedMem,
      free_bytes: freeMem,
      used_pct: totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0,
    },
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model?.trim() || '',
      load_1: load[0],
      load_5: load[1],
      load_15: load[2],
      usage_pct: opts.cpuUsagePct ?? null,
    },
    network: speed
      ? {
        available: true,
        rx_bytes_per_sec: speed.rx_bytes_per_sec,
        tx_bytes_per_sec: speed.tx_bytes_per_sec,
      }
      : {
        available: false,
        note: os.platform() === 'darwin'
          ? 'macOS 暂不支持实时网速采样'
          : '暂无法读取网卡速率',
      },
  }
}
