# 安装与部署文档

本目录集中存放项目的安装、配置与发布说明。按使用场景选择对应文档即可。

## 文档索引

| 文档 | 适用场景 |
|------|----------|
| [本地开发快速开始.md](./本地开发快速开始.md) | 本机首次拉取/解压后，快速 `npm install` 并启动开发环境 |
| [新电脑完整配置指南.md](./新电脑完整配置指南.md) | 从备份 zip 或另一台电脑迁移项目、拷贝数据库与配置 |
| [宝塔三步安装.txt](./宝塔三步安装.txt) | 宝塔面板上线：上传 → 安装 → 反代（简明版） |
| [发布到服务器.md](./发布到服务器.md) | 宝塔/Nginx/PM2 完整部署、更新、备份与排错 |
| [id.meituyin.cn-从GitHub到宝塔完整部署.md](./id.meituyin.cn-从GitHub到宝塔完整部署.md) | **实录**：GitHub 推送 → 宝塔建站 → 终端克隆 → PM2 → 安装成功（含踩坑） |
| [id.meituyin.cn-部署简版.txt](./id.meituyin.cn-部署简版.txt) | id 站上线 **九步简版**（备忘条） |
| [id.meituyin.cn-部署视频脚本.md](./id.meituyin.cn-部署视频脚本.md) | id 站部署 **录屏教程脚本/分镜**（约 20 分钟） |
| [id.meituyin.cn-Git部署.md](./id.meituyin.cn-Git部署.md) | id 站 Git + 宝塔简版步骤 |

## 安装后生成的文件

通过网页安装向导（`/install.html`）或 `bash install.sh` 完成后，本目录还会自动生成：

| 文件 | 说明 |
|------|------|
| `nginx-baota.conf` | Nginx 反向代理配置片段 |npm 
| `安装完成.txt` | 站点地址、端口、登录页等摘要 |

## 相关入口（项目根目录）

- `.env.example` — 环境变量模板
- `install.html` / `install.sh` — 服务器一键安装
- 根目录 [README.md](../README.md) — 项目概览与常用命令
