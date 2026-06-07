Cat8 部署包 — cert.meituyin.cn
================================

打包时间：2026-06-02T11:11:01.428Z

【上传后】
1. 宝塔解压到网站根目录（如 /www/wwwroot/cert.meituyin.cn）
2. chown -R www:www .
3. sudo -u www npm install
4. 编辑 .env：
   CORS_ORIGIN=https://cert.meituyin.cn
   NODE_ENV=production
5. PM2 启动 server/index.js 端口 3001
6. Nginx 反代到 127.0.0.1:3001

【已包含】dist/、data/cat.db、uploads/、svg-templates/、.env
【未包含】node_modules/、data/backups/

详细步骤：安装步骤/发布到服务器.md
