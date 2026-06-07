#!/usr/bin/env node
/**
 * 将管理员密码重置为 .env 中的 ADMIN_PASSWORD（默认 admin1234）
 * 用法：node scripts/reset-admin-password.mjs
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { openDatabase } from '../server/db.js'

const username = process.env.ADMIN_USERNAME || 'admin'
const password = process.env.ADMIN_PASSWORD || 'admin1234'

const db = openDatabase()
const hash = bcrypt.hashSync(password, 10)
const now = new Date().toISOString()
const existing = db.prepare('SELECT id FROM admin_user WHERE username = ?').get(username)

if (existing) {
  db.prepare('UPDATE admin_user SET password_hash = ? WHERE id = ?').run(hash, existing.id)
  console.log(`已更新用户「${username}」的密码（与 .env 中 ADMIN_PASSWORD 一致）`)
} else {
  db.prepare(
    'INSERT INTO admin_user (username, password_hash, created_at) VALUES (?, ?, ?)',
  ).run(username, hash, now)
  console.log(`已创建管理员「${username}」`)
}

console.log(`请使用：用户名 ${username}  密码 ${password}`)
