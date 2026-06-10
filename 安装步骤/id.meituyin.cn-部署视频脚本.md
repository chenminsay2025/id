# id.meituyin.cn 部署教程 — 视频脚本与分镜

> 本文档为**录屏教程脚本**，不是视频文件。按分镜录制后，可用 OBS / 剪映 / 必剪 剪辑成片。  
> 对应文字版：[id.meituyin.cn-从GitHub到宝塔完整部署.md](./id.meituyin.cn-从GitHub到宝塔完整部署.md)

---

## 成片信息（建议）

| 项 | 建议 |
|----|------|
| 标题 | 《猫咪血统证书 · id 站从 GitHub 部署到宝塔（完整版）》 |
| 时长 | 约 18～25 分钟（可拆成上/下两集） |
| 形式 | 屏幕录制 + 旁白（中文） |
| 分辨率 | 1920×1080，码率适中即可 |
| 受众 | 已会用宝塔、有域名与云服务器的管理员 |

**上集（约 10 分钟）**：GitHub 推送 + 宝塔建站 + 终端克隆构建  
**下集（约 10 分钟）**：PM2 / 反代 / 安装 / 验证 / 更新与踩坑

---

## 录制前准备

- [ ] 本机：项目目录、Git、SSH 已配 GitHub
- [ ] 服务器：宝塔可登录、PM2 / Node 20+ 已装
- [ ] 域名：`id.meituyin.cn` DNS 可解析（或演示用测试域名）
- [ ] 终端字号调大（建议 16～18px），录屏更清晰
- [ ] 敏感信息打码：`.env` 密码、宝塔面板地址端口、Webhook 密钥

---

## 分镜脚本

### 【片头】0:00 — 0:45

| 画面 | 旁白 |
|------|------|
| 标题页：域名 id.meituyin.cn、仓库 github.com/chenminsay2025/id | 本节演示：如何把猫咪血统证书项目，从 GitHub 同步到宝塔服务器并完成安装。与 cat 站并存时，id 站使用独立端口 3004。 |
| 流程示意图（可用文档第一节 ASCII 或自绘） | 整体流程是：本地 push 到 GitHub，服务器 git clone，npm 构建，PM2 启动 Node，Nginx 反代，最后网页安装向导初始化数据库。 |

---

### 【第一章】本地推送到 GitHub · 0:45 — 3:30

| 时间 | 画面 | 旁白 | 操作要点 |
|------|------|------|----------|
| 0:45 | 浏览器打开 GitHub 仓库 id | 代码托管在 GitHub，分支 main。数据库和 SVG 文件不进 Git，由 gitignore 排除。 | 展示仓库文件树，指出无 data/cat.db |
| 1:15 | 本机终端 | 推送前确认 SSH：`ssh -T git@github.com` | 执行命令，显示 Hi chenminsay2025 |
| 1:45 | 本机终端 | 设置远程并推送：`git remote -v`、`git push origin main` | 可演示一次小改动 commit push |
| 2:30 | .gitignore 文件 | 强调：cat.db、svg-templates、.env 不会上传；服务器要单独备份或安装时新建。 | 滚动展示 gitignore 相关行 |
| 3:00 | — | 首次服务器拉取建议浅克隆 depth 1，避免 GitHub 慢和旧历史大文件。 | 过渡到服务器 |

**字幕关键词**：`git push` · `main` · `不进 Git 的数据`

---

### 【第二章】宝塔建站与 DNS · 3:30 — 6:00

| 时间 | 画面 | 旁白 | 操作要点 |
|------|------|------|----------|
| 3:30 | 域名 DNS 面板 | 添加 A 记录 id.meituyin.cn 指向服务器 IP。 | 打码 IP 也可 |
| 4:00 | 宝塔 → 网站 → 添加站点 | 选**传统项目**，不要用 Git 部署点确定——实测容易克隆超时。 | 域名、目录 /www/wwwroot/id.meituyin.cn |
| 4:45 | 说明卡片（可插入 PPT 一页） | Git 部署能刷分支，但完整 clone 要几分钟，面板超时会失败。首次用终端克隆更稳。 | — |
| 5:15 | SSL 申请 | 申请 Let's Encrypt，开启强制 HTTPS。 | 点击申请、强制 HTTPS |
| 5:45 | Git 管理（可选） | 建站后可在设置里绑定仓库和部署脚本，用于日后 git pull 自动构建。 | 展示仓库 URL、main、脚本框 |

**字幕关键词**：`传统建站` · `Git 部署易超时` · `SSL`

---

### 【第三章】终端克隆与构建 · 6:00 — 10:30

| 时间 | 画面 | 旁白 | 操作要点 |
|------|------|------|----------|
| 6:00 | 宝塔终端 | 进入站点目录，确认目录为空或清理残留。 | `cd /www/wwwroot/id.meituyin.cn` `ls -la` |
| 6:30 | 终端执行 clone | 浅克隆：`git clone --depth 1 -b main git@github.com:chenminsay2025/id.git .` | 等待进度条，说明可能较慢 |
| 7:30 | clone 完成 | 看到 package.json 即成功。若 EACCES，是因为 root 克隆，需 chown。 | `ls package.json` |
| 8:00 | chown + npm | `chown -R www:www .`，npm 镜像，install 和 build。 | 展示 build 成功 dist/ |
| 9:30 | 权限说明页（字幕） | root 装依赖要 chown；或用 sudo -u www npm。git pull 后也要 chown。 | — |
| 10:00 | — | 构建完成后进入环境配置。 | — |

**屏幕字幕（贴命令）**：

```bash
git clone --depth 1 -b main git@github.com:chenminsay2025/id.git .
chown -R www:www .
sudo -u www npm config set registry https://registry.npmmirror.com
sudo -u www npm install && sudo -u www npm run build
```

---

### 【第四章】环境变量与 PM2 · 10:30 — 13:30

| 时间 | 画面 | 旁白 | 操作要点 |
|------|------|------|----------|
| 10:30 | 编辑 .env | 复制 example，PORT=3004，CORS 填 https://id.meituyin.cn，NODE_ENV=production。 | 密码打码 |
| 11:15 | PM2 管理器 | 添加项目 id-svg：启动 server/index.js，目录网站根，用户 www，端口 3004。 | 不要重复添加 id-server |
| 12:15 | 终端 curl | 未安装前 install.html 返回 200，api/meta 返回 403 是正常的。 | 演示两条 curl |
| 13:00 | pm2 logs（若有崩溃可剪入） | 若启动失败看日志；group_id 错误需 git pull 删库重装——后面踩坑专讲。 | 可选 |

**字幕关键词**：`PORT=3004` · `id-svg` · `403 未安装正常`

---

### 【第五章】反代与安装向导 · 13:30 — 17:00

| 时间 | 画面 | 旁白 | 操作要点 |
|------|------|------|----------|
| 13:30 | 对比演示（可截图） | 关反代：nginx 只给静态 install 页；开反代但 Node 未起：502。Node 正常后开反代才能完整安装。 | 三张对比图 |
| 14:15 | 反向代理设置 | 目标 http://127.0.0.1:3004，发送域名 $host。 | 保存 |
| 14:45 | 浏览器 install.html | 填 https://id.meituyin.cn、端口 3004、管理员密码，开始安装。 | 录完整点击过程 |
| 15:45 | 安装成功页 | 安装生成 data/.installed 和 cat.db，在服务器本地不在 GitHub。 | — |
| 16:15 | PM2 重启 + 验证 | 重启 id-svg，访问 api/meta、login.html。 | api/meta 变 200 |

**字幕关键词**：`502 = Node 未监听` · `install.html`

---

### 【第六章】日后更新与踩坑 · 17:00 — 20:30

| 时间 | 画面 | 旁白 | 操作要点 |
|------|------|------|----------|
| 17:00 | 本地 push | 日常：改代码 push main。 | — |
| 17:30 | deploy-from-git.sh | 服务器执行脚本：pull、install、build、pm2 restart。 | 展示脚本路径 |
| 18:15 | Git 管理部署脚本框 | 可写入宝塔 Git 管理，配合 Webhook 或计划任务。 | 粘贴脚本 |
| 18:45 | 踩坑列表（字幕页） | ① Git 部署超时 → 终端浅克隆 ② npm EACCES → chown ③ 502 → PM2/端口 ④ group_id → pull 删库重装 | 每条 5 秒 |
| 19:45 | 简版 txt / README | 备忘见部署简版九步；详细见完整部署 md。 | 展示文件路径 |
| 20:15 | 片尾 | 备份 data/cat.db；与 cat 站端口勿冲突。 | 结束 |

---

### 【片尾】20:30 — 21:00

| 画面 | 旁白 |
|------|------|
| 链接汇总页 | 仓库 github.com/chenminsay2025/id，文档在仓库 安装步骤 目录。感谢观看。 |

---

## 旁白全文（连贯版，约 2200 字）

可按分镜分段录制，也可一次性朗读后剪辑对齐画面。

> 大家好。这期视频演示如何把「猫咪血统证书」项目部署到新站点 id.meituyin.cn。  
> 我们使用 GitHub 存放代码，用宝塔面板管理服务器，用 PM2 运行 Node 后端，用 Nginx 做反向代理。  
> 如果同一台机器上已经有 cat.meituyin.cn，记得 id 站要用不同端口，本教程使用 3004。  
>  
> 第一步，本地把代码推到 GitHub。仓库地址是 chenminsay2025/id，主分支 main。  
> 推送前用 ssh -T git@github.com 确认密钥正常。  
> 注意数据库 cat.db、SVG 模板目录、环境变量 env 文件都不会进 Git，这是故意设计的，业务数据只在服务器本地。  
>  
> 第二步，在域名服务商添加 A 记录，让 id.meituyin.cn 指向你的云服务器。  
> 登录宝塔，用「传统项目」添加网站，目录设为 wwwroot 下的 id.meituyin.cn，并申请 SSL 开启 HTTPS。  
> 不建议第一次就用「Git 部署」点确定建站，因为完整克隆 GitHub 容易超时；分支能刷出来，但 clone 会失败。  
> 首次请在终端用浅克隆。  
>  
> 第三步，SSH 登录服务器，进入网站目录，执行 git clone depth 1 只拉 main 最新代码。  
> 克隆完成后 chown 把整个目录交给 www 用户，然后 npm install 和 npm run build。  
> 如果 npm 报权限错误，就是忘了 chown。  
>  
> 第四步，复制 env 示例文件，设置端口 3004、站点域名、生产环境和强密码。  
> 在 PM2 管理器添加 id-svg，启动文件 server/index.js，运行目录是网站根，用户 www。  
> 用 curl 测试：install 页面 200 表示 Node 已启动；api meta 返回 403 说明还没安装，这是正常的。  
>  
> 第五步，配置反向代理到 127.0.0.1:3004。  
> 只有反代指向正在运行的 Node，网站才能完整工作；否则会 502。  
> 浏览器打开 install.html，按向导填写域名和端口，完成安装后重启 PM2。  
> 此时 api meta 应返回 200，就可以登录管理后台了。  
>  
> 以后更新代码，本地 push 后，在服务器运行 deploy-from-git 脚本即可。  
> 常见问题：Git 面板克隆超时用终端；npm 权限用 chown；502 查 PM2 和端口；数据库迁移错误就 pull 最新代码、删除半残 cat.db 重新安装。  
>  
> 更详细的文字说明在仓库「安装步骤」文件夹。祝部署顺利，再见。

---

## 剪辑建议

| 技巧 | 说明 |
|------|------|
| 画中画 | 终端全屏为主，宝塔操作可缩放右下角 |
| 快进 | `npm install`、git clone 等待段可 4～8 倍速 |
| 强调 | 502/403/EACCES 处加红框或「注意」贴纸 |
| 章节 | 剪映章节：GitHub / 建站 / 克隆 / PM2 / 安装 / 踩坑 |
| 附件 | 片尾 QR 或链接指向 GitHub 文档 raw 路径 |

---

## 若需 AI 配音

可将「旁白全文」分段粘贴到剪映「文本朗读」或第三方 TTS，再对齐录屏。人声录制通常更清晰、更可信。

---

## 相关文件

| 文件 | 用途 |
|------|------|
| [id.meituyin.cn-从GitHub到宝塔完整部署.md](./id.meituyin.cn-从GitHub到宝塔完整部署.md) | 录屏时对照操作 |
| [id.meituyin.cn-部署简版.txt](./id.meituyin.cn-部署简版.txt) | 片尾展示的九步备忘 |
| `scripts/deploy-from-git.sh` | 第六章演示用 |

---

*脚本版本：2026-06-10*
