/**
 * 按 scripts/git-push.config.json 暂存「可提交」文件并 push。
 *
 * 用法：
 *   npm run git:push -- "feat: 公众页侧栏可收起"
 *   npm run git:push -- --dry-run
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(root, 'scripts', 'git-push.config.json')

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  return {
    include: Array.isArray(raw.include) ? raw.include : [],
    exclude: Array.isArray(raw.exclude) ? raw.exclude : [],
  }
}

/** @param {string} filePath @param {string} pattern */
function matchPattern(filePath, pattern) {
  const norm = filePath.replace(/\\/g, '/')
  const p = pattern.replace(/\\/g, '/')
  if (p.endsWith('/**')) {
    const base = p.slice(0, -3)
    return norm === base || norm.startsWith(`${base}/`)
  }
  if (p.includes('*')) {
    const re = new RegExp(
      `^${p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§§')
        .replace(/\*/g, '[^/]*')
        .replace(/§§/g, '.*')}$`,
    )
    return re.test(norm)
  }
  return norm === p
}

/** @param {string} filePath @param {string[]} patterns */
function matchesAny(filePath, patterns) {
  return patterns.some((pat) => matchPattern(filePath, pat))
}

function runGit(args, opts = {}) {
  const res = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : 'pipe',
  })
  if (res.status !== 0 && !opts.allowFail) {
    const err = (res.stderr || res.stdout || '').trim()
    throw new Error(err || `git ${args.join(' ')} 失败`)
  }
  return res
}

function listChangedFiles() {
  const res = runGit(['status', '--porcelain', '-uall'])
  const files = []
  for (const line of (res.stdout || '').split('\n')) {
    if (!line.trim()) continue
    const status = line.slice(0, 2)
    const file = line.slice(3).trim().replace(/^"(.*)"$/, '$1')
    if (status.includes('D')) continue
    const real = file.includes(' -> ') ? file.split(' -> ').pop().trim() : file
    files.push(real)
  }
  return files
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run')
  const msgParts = argv.filter((a) => a !== '--dry-run')
  const message = msgParts.join(' ').trim()
  return { dryRun, message }
}

function main() {
  const { dryRun, message } = parseArgs(process.argv.slice(2))
  const { include, exclude } = loadConfig()
  const changed = listChangedFiles()

  const toStage = []
  const skipped = []
  for (const file of changed) {
    if (matchesAny(file, exclude)) {
      skipped.push(file)
      continue
    }
    if (matchesAny(file, include)) {
      toStage.push(file)
      continue
    }
    skipped.push(file)
  }

  if (!toStage.length) {
    console.log('没有符合 git-push.config.json 的可提交改动。')
    if (skipped.length) {
      console.log('已跳过（未纳入 include 或在 exclude 中）：')
      skipped.forEach((f) => console.log(`  - ${f}`))
    }
    process.exit(1)
  }

  console.log('将暂存以下文件：')
  toStage.forEach((f) => console.log(`  + ${f}`))
  if (skipped.length) {
    console.log('已跳过：')
    skipped.forEach((f) => console.log(`  - ${f}`))
  }

  if (!message) {
    console.error('\n请提供提交说明，例如：')
    console.error('  npm run git:push -- "feat: 公众页侧栏可收起"')
    process.exit(1)
  }

  if (dryRun) {
    console.log(`\n[dry-run] 将执行: git commit -m "${message}" && git push`)
    return
  }

  runGit(['add', '--', ...toStage], { inherit: true })
  runGit(['commit', '-m', message], { inherit: true })
  runGit(['push'], { inherit: true })
  console.log('\n已推送完成。')
}

main()
