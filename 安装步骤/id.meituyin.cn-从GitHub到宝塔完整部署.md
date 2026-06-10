# id.meituyin.cn — 从 GitHub 到宝塔完整部署实录

本文档记录 **2026-06** 将猫咪血统证书项目部署到新域名 `id.meituyin.cn` 的完整过程：本地推送到 GitHub → 宝塔建站 → 终端拉代码 → 构建 → PM2 → 反代 → 安装向导 → 上线成功。

**代码仓库**：[github.com/chenminsay2025/id](https://github.com/chenminsay2025/id)（分支 `main`）  
**服务器环境**：OpenCloudOS + 宝塔面板 + PM2 + Node 20.x  
**与 cat 站并存**：`cat.meituyin.cn` 占端口 **3003**，本站点用 **3004**

---

## 一、总览流程

```text
本地开发机                         GitHub                    宝塔服务器
──────────                         ──────                    ──────────
git commit / push  ──────────────►  main 分支
                                   │
                                   │  git clone（终端，浅克隆）
                                   ▼
                              /www/wwwroot/id.meituyin.cn
                                   │
                    npm install + npm run build
                                   │
                    .env + PM2(id-svg) :3004
                                   │
                    Nginx 反代 → https://id.meituyin.cn
                                   │
                    /install.html 完成安装
```

---

## 二、本地：推送到 GitHub

### 2.1 前置条件

- 本机已安装 Git，配置用户邮箱（提交作者用）
- GitHub 账号：`chenminsay2025`
- 本机 SSH 密钥已添加到 GitHub（Settings → SSH and GPG keys）

验证本机 SSH：

```bash
ssh -T git@github.com
# 期望：Hi chenminsay2025! You've successfully authenticated...
```

### 2.2 仓库与远程

新仓库地址（SSH）：

```text
git@github.com:chenminsay2025/id.git
```

设置远程并推送到 `main`（仅保留 main，无功能分支）：

```bash
cd /path/to/cat10_CC
git remote set-url origin git@github.com:chenminsay2025/id.git
git checkout main
git push -u origin main
```

### 2.3 什么进 Git、什么不进

`.gitignore` 已排除，**不要**指望 Git 同步业务数据：

| 不进 GitHub | 说明 |
|-------------|------|
| `data/cat.db` | 数据库 |
| `data/svg-templates/` | SVG 模板文件 |
| `data/backups/` | 备份 |
| `data/uploads/` | 上传图片 |
| `.env` | 环境变量（含密码） |
| `node_modules/` | 依赖（服务器上 `npm install`） |

服务器上的业务数据需 **单独上传** 或走 **安装向导新建**。

### 2.4 仓库体积说明

早期提交历史里曾包含约 62MB 的 `data/_pack-tmp/cat.db`，当前 `main` 树中已无 `data/`，但 **完整 `git clone` 仍可能较慢**。服务器首次拉取建议用 **浅克隆**（见第四节）。

---

## 三、宝塔面板：建站与 DNS

### 3.1 域名解析

为 `id.meituyin.cn` 添加 **A 记录**，指向与 `cat.meituyin.cn` 相同的服务器 IP。

### 3.2 添加网站（推荐：传统项目）

**网站** → **添加站点**：

| 项 | 值 |
|----|-----|
| 域名 | `id.meituyin.cn` |
| 根目录 | `/www/wwwroot/id.meituyin.cn` |
| PHP | 纯静态 / 不创建 PHP |

### 3.3 SSL

站点 → **SSL** → Let's Encrypt → 申请证书 → **强制 HTTPS**。

### 3.4 关于「Git 部署」建站

宝塔 **添加站点 → Git 部署** 可以刷新分支列表，但点「确定」完整克隆时可能 **超时**（`git克隆操作超时`）：

- 刷新分支只做 `ls-remote`，很快
- 确定要做完整 `git clone`，受 GitHub 国际带宽影响大
- 面板 **没有** 可调的克隆超时设置

**实测结论**：首次部署用 **传统建站 + 终端浅克隆** 更稳；建站后在 **Git 管理** 里绑定仓库做日后更新。

### 3.5 Git 管理（可选，用于日后更新）

站点 → **设置** → **Git 管理** → **仓库**：

| 项 | 值 |
|----|-----|
| 仓库 | `git@github.com:chenminsay2025/id.git` 或 HTTPS 地址 |
| 分支 | `main` |
| SSH 公钥 | 复制面板生成的公钥，添加到 GitHub |

**部署脚本**（`git pull` 之后执行）：

```bash
cd /www/wwwroot/id.meituyin.cn
chown -R www:www .
sudo -u www npm install
sudo -u www npm run build
pm2 restart id-svg
```

> 「部署记录」为空表示从未成功拉取过；首次必须先终端 `git clone`。

---

## 四、服务器终端：首次拉取代码

### 4.1 配置宝塔 SSH 公钥到 GitHub

1. Git 管理页复制 **SSH 公钥**
2. GitHub → Settings → SSH and GPG keys → New SSH key
3. 服务器验证：`ssh -T git@github.com`

### 4.2 清空目录并浅克隆

```bash
cd /www/wwwroot/id.meituyin.cn
rm -f package-lock.json
rm -rf id .git
ls -la    # 应只剩 . 和 ..

git clone --depth 1 -b main git@github.com:chenminsay2025/id.git .
```

- `--depth 1`：只拉 `main` 最新一层，约 20MB，比完整历史快很多
- HTTPS 若报 `Failure when receiving data from the peer`，改用 SSH

克隆成功后应有 `package.json`、`server/`、`scripts/deploy-from-git.sh`。

### 4.3 权限注意

`git clone` 若以 **root** 执行，文件属主为 root；`www` 用户无法 `npm install`。

**二选一**：

```bash
# 方式 A：先改属主，再用 www 安装（推荐）
chown -R www:www .
sudo -u www npm config set registry https://registry.npmmirror.com
sudo -u www npm install
sudo -u www npm run build

# 方式 B：root 安装后改属主
npm config set registry https://registry.npmmirror.com
npm install && npm run build
chown -R www:www .
```

---

## 五、环境变量 `.env`

```bash
cd /www/wwwroot/id.meituyin.cn
cp .env.example .env
nano .env
```

生产环境至少配置：

```env
PORT=3004
JWT_SECRET=随机长字符串
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码
CORS_ORIGIN=https://id.meituyin.cn
NODE_ENV=production
```

```bash
chown www:www .env
chmod 600 .env
```

| 项 | 说明 |
|----|------|
| `PORT` | 必须与 PM2、反代端口一致；与 cat 站 **3003** 错开 |
| `CORS_ORIGIN` | 必须是浏览器访问的 **https** 域名 |
| `NODE_ENV=production` | Cookie 带 Secure，HTTPS 下必需 |

---

## 六、PM2 管理器

宝塔 → **PM2 管理器** → **添加项目**：

| 配置项 | 填写 |
|--------|------|
| 项目名称 | `id-svg` |
| 启动文件 | `server/index.js` |
| 运行目录 | `/www/wwwroot/id.meituyin.cn` |
| 运行用户 | `www` |
| Node 版本 | ≥ 20.19 |
| 端口 | `3004` |

保存 → **启动**。

**避免重复进程**：同一目录不要同时跑 `id-server` 与 `id-svg`，只保留一个。

验证本机 API：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3004/install.html
# 未安装前：200

curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3004/api/meta
# 未安装前：403（正常，安装完成后变为 200）
```

---

## 七、Nginx 反向代理

站点 `id.meituyin.cn` → **反向代理**：

| 项 | 值 |
|----|-----|
| 目标 URL | `http://127.0.0.1:3004` |
| 发送域名 | `$host` |

防火墙 / 安全组只开 **80、443**，不要对公网开放 3004。

### 502 / 安装页现象说明

| 现象 | 原因 |
|------|------|
| **关反代**能看安装页 | Nginx 直接当静态站提供根目录 `install.html` |
| **开反代** 502 | Node 未在 3004 监听（PM2 崩溃或未启动） |
| `curl` 返回 `000` | 端口无进程 |
| `/api/meta` 返回 `403` | **未安装前正常**，完成 install 后变 200 |

---

## 八、网页安装向导

1. 确认反代已开，`curl` 对 `install.html` 为 200
2. 浏览器打开：**https://id.meituyin.cn/install.html**
3. 填写：
   - 网站地址：`https://id.meituyin.cn`
   - API 端口：`3004`
   - 管理员账号、密码
4. **开始安装**
5. PM2 → **重启** `id-svg`
6. 验证：
   - https://id.meituyin.cn/api/meta
   - https://id.meituyin.cn/login.html

安装成功后会生成 `data/.installed`、`data/cat.db`（在服务器本地，不在 GitHub）。

---

## 九、新库安装踩坑：数据库迁移 v6（已修复）

### 现象

PM2 显示 `online`，但 `curl http://127.0.0.1:3004` 返回 `000`，错误日志：

```text
SqliteError: no such column: group_id
at server/db.js (v6 迁移建索引)
```

### 原因

全新空库时，v6 迁移在 `certificates.group_id` 列创建 **之前** 就建了依赖 `group_id` 的索引；`group_id` 由后续的 `migrateAccessGroups` 添加，导致启动崩溃。

### 处理（服务器）

```bash
cd /www/wwwroot/id.meituyin.cn
git pull origin main          # 含修复 commit
rm -f data/cat.db data/cat.db-wal data/cat.db-shm
chown -R www:www .
pm2 restart id-svg
```

再访问 `/install.html` 重新安装。

---

## 十、日后更新代码

### 10.1 本地

```bash
git add ...
git commit -m "说明"
git push origin main
```

### 10.2 服务器

```bash
cd /www/wwwroot/id.meituyin.cn
PM2_NAME=id-svg bash scripts/deploy-from-git.sh
```

或宝塔 **Git 管理** 触发拉取 + 部署脚本。

### 10.3 宝塔计划任务（可选）

每 5–10 分钟执行：

```bash
cd /www/wwwroot/id.meituyin.cn && PM2_NAME=id-svg bash scripts/deploy-from-git.sh >> /www/wwwlogs/id-deploy.log 2>&1
```

### 10.4 更新前备份

```bash
cp data/cat.db data/backups/cat-$(date +%F).db
# 如有上传图片：备份 data/uploads/、data/svg-templates/
```

---

## 十一、从本机迁移旧数据（可选）

若不要空库安装，而要沿用本机 `cat.db`：

1. 本机打包（不含 node_modules）：`npm run pack:deploy`
2. 宝塔文件上传到 `data/cat.db`、`data/svg-templates/` 等
3. 写好 `.env`，**不要**再访问 `/install.html`（已有 `data/.installed` 时）
4. `pm2 restart id-svg`

---

## 十二、检查清单（上线前）

- [ ] DNS `id.meituyin.cn` → 服务器 IP
- [ ] SSL 已开启
- [ ] `git clone --depth 1` 成功，`package.json` 存在
- [ ] `npm run build` 成功，`dist/` 存在
- [ ] `.env` 中 `PORT=3004`、`CORS_ORIGIN=https://id.meituyin.cn`
- [ ] PM2 `id-svg` online，无重复 `id-server`
- [ ] 反代 → `http://127.0.0.1:3004`
- [ ] `curl` install.html → 200
- [ ] `/install.html` 安装完成
- [ ] `/api/meta` → 200

---

## 十三、常见问题速查

| 现象 | 处理 |
|------|------|
| Git 部署确定超时 | 终端 `git clone --depth 1` |
| `EACCES` npm install | `chown -R www:www .` 后再装 |
| 502 Bad Gateway | PM2 是否 online；端口是否与反代一致 |
| 关反代能看页、开反代 502 | Node 未监听；看 `pm2 logs` |
| `/api/meta` 403 | 未安装，先走 install |
| `no such column: group_id` | `git pull` + 删 `data/cat.db` + 重装 |
| GitHub 很慢 | 浅克隆；或本机 zip 上传；长期可迁 Gitee |

---

## 十四、相关文档

| 文档 | 用途 |
|------|------|
| [id.meituyin.cn-Git部署.md](./id.meituyin.cn-Git部署.md) | Git + 宝塔简版步骤 |
| [发布到服务器.md](./发布到服务器.md) | cat 站 PM2/反代通用说明 |
| [宝塔三步安装.txt](./宝塔三步安装.txt) | 最简三行备忘 |
| `scripts/deploy-from-git.sh` | 服务器一键 pull + build + 重启 |

---

*文档版本：2026-06-10，对应仓库 main 分支（含 v6 迁移修复）。*
