@echo off
chcp 65001 >nul
cd /d "%~dp0.."

REM 优先使用官方 Node 22/20（避免 PATH 里旧的 v16）
set "NODE_DIR=C:\Program Files\nodejs"
if exist "%NODE_DIR%\node.exe" (
  set "PATH=%NODE_DIR%;%PATH%"
)

echo [Cat] Node 版本:
node -v
node scripts\check-node.mjs
if errorlevel 1 exit /b 1

node scripts\dev-mark-installed.mjs
echo [Cat] 启动开发服务 http://localhost:5173 ...
call npm run dev
