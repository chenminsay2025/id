# id.meituyin.cn — 从 GitHub 部署（宝塔 + PM2）

代码仓库：[github.com/chenminsay2025/id](https://github.com/chenminsay2025/id/tree/main)  
与现有 `cat.meituyin.cn` **并存**时，本站点请用 **独立端口**（建议 `3004`）和 **独立 PM2 项目名**（建议 `id-svg`）。

> AI 无法代替你登录宝塔面板；按下面顺序在面板 + SSH 终端各操作一次即可。之后更新只需 `git push` + 运行部署脚本（或计划任务自动拉取）。

---

## 0. 域名 DNS

在域名解析里为 `id.meituyin.cn` 添加 **A 记录**，指向与 `cat.meituyin.cn` 相同的服务器 IP。  
解析生效后再申请 SSL。

---

## 1. 宝塔 — 添加网站

1. **网站** → **添加站点**
2. 域名：`id.meituyin.cn`
3. 根目录：`/www/wwwroot/id.meituyin.cn`
4. PHP 版本：纯静态 / 不创建 PHP（与 cat 站相同做法）
5. 创建完成后：**SSL** → Let's Encrypt → 开启强制 HTTPS

---

## 2. SSH 终端 — 首次克隆（仅一次）

宝塔 **终端** 或 SSH 登录服务器后执行：

```bash
# 若目录已存在且为空，先进入；否则删除空目录后 clone
cd /www/wwwroot
rm -rf id.meituyin.cn   # 仅当该目录是空站点且无数据时执行
git clone git@github.com:chenminsay2025/id.git id.meituyin.cn

cd /www/wwwroot/id.meituyin.cn
chown -R www:www .
chmod +x scripts/deploy-from-git.sh

# 若服务器尚未配置 GitHub SSH，可改用 HTTPS：
# git clone https://github.com/chenminsay2025/id.git id.meituyin.cn
```

---

## 3. 安装依赖并构建

```bash
cd /www/wwwroot/id.meituyin.cn
sudo -u www npm config set registry https://registry.npmmirror.com
sudo -u www npm install
sudo -u www npm run build
```

Node 需 **≥ 20.19**（与 `package.json` 的 `engines` 一致），在宝塔 **Node 版本管理器** 中选用。

---

## 4. 环境变量 `.env`

```bash
cd /www/wwwroot/id.meituyin.cn
cp .env.example .env
```

编辑 `.env`（宝塔文件管理或 `nano .env`）：

```env
PORT=3004
JWT_SECRET=请改为随机长字符串
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的强密码
CORS_ORIGIN=https://id.meituyin.cn
NODE_ENV=production
```

- **新机**：不要上传 `data/.installed`，稍后走网页安装。
- **从本机迁移**：另传 `data/cat.db`、`data/svg-templates/`、`data/uploads/`（如有），并复制 `data/.installed`；**不要**再打开 `/install.html`。

---

## 5. PM2 管理器 — 添加项目

| 配置项 | 填写 |
|--------|------|
| 项目名称 | `id-svg` |
| 启动文件 | `server/index.js` |
| 运行目录 | `/www/wwwroot/id.meituyin.cn` |
| 运行用户 | `www` |
| Node 版本 | 20.19+ |
| 端口 | `3004` |

保存 → **启动**。日志应出现：`[CAT API] http://localhost:3004`。

> 若与 `cat-svg` 同机，**切勿**两个站点共用同一端口。

---

## 6. 首次初始化（二选一）

### A. 全新站点（推荐新域名）

1. PM2 已启动
2. 浏览器打开：`https://id.meituyin.cn/install.html`
3. 网站地址填 `https://id.meituyin.cn`，端口 `3004`，设置管理员密码
4. 安装完成后 PM2 → **重启** `id-svg`

### B. 从本机/旧站迁移数据

1. 上传 `data/cat.db` 等到 `data/`
2. 按上一节写好 `.env`
3. PM2 重启，**不要**访问 install

---

## 7. Nginx 反向代理

网站 `id.meituyin.cn` → **反向代理** → 添加：

| 项 | 值 |
|----|-----|
| 目标 URL | `http://127.0.0.1:3004` |
| 发送域名 | `$host` |

保存。防火墙只开放 80/443，**不要**对公网开放 3004。

---

## 8. 验证

| 检查 | 地址 |
|------|------|
| API | https://id.meituyin.cn/api/meta |
| 安装/登录 | https://id.meituyin.cn/login.html |
| 管理端 | https://id.meituyin.cn/ |

---

## 9. 与 GitHub 同步更新（「实时」）

本地 `git push` 到 `main` 后，在服务器执行：

```bash
cd /www/wwwroot/id.meituyin.cn
PM2_NAME=id-svg bash scripts/deploy-from-git.sh
```

### 可选：宝塔计划任务自动拉取

**计划任务** → 添加 **Shell 脚本**，周期如每 5 分钟：

```bash
cd /www/wwwroot/id.meituyin.cn && PM2_NAME=id-svg bash scripts/deploy-from-git.sh >> /www/wwwlogs/id-deploy.log 2>&1
```

这样 push 到 GitHub 后最多几分钟内自动上线（非秒级 webhook，但无需手动的「准实时」）。

---

## 10. 常见问题

| 现象 | 处理 |
|------|------|
| 502 | PM2 中 `id-svg` 是否在线；反代端口是否为 3004 |
| git pull 失败 | 服务器配置 GitHub SSH 密钥，或改用 HTTPS remote |
| 与 cat 站串台 | 检查 `.env` 的 `CORS_ORIGIN` 与 PM2 端口是否各自独立 |
| 数据库不要进 Git | 正常；`data/cat.db` 只在服务器本地，用备份/迁移单独维护 |

---

## 11. 备份

定期备份服务器上的 `data/cat.db`、`data/svg-templates/`、`data/uploads/`、`.env`（勿提交到 GitHub）。
