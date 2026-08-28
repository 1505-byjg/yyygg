@echo off
chcp 65001 >nul
title YaoYao Station - 新启动器
cd /d "%~dp0"

echo ==========================================
echo   摇摇又汞汞站  本地新启动器
echo ==========================================
echo.

set "NODE=C:\Users\cmsn\.workbuddy\binaries\node\versions\22.22.2\node.exe"
if not exist "%NODE%" set "NODE=D:\node\node.exe"
if not exist "%NODE%" set "NODE=node"

echo 使用 Node: %NODE%
echo.

if not exist "tools\serve.cjs" goto nofile
if not exist "tools\publish.cjs" goto nofile
if not exist "tools\_kill-port.cjs" goto nofile

echo 释放 8787 端口（清理可能残留的旧 author.cjs）...
"%NODE%" tools\_kill-port.cjs 8787
echo.

echo [1/2] 启动站点     http://localhost:8080
start "站点 8080 - 请勿关闭" /d "%~dp0" cmd /k "%NODE% tools\serve.cjs"

echo [2/2] 启动发稿器   http://localhost:9090  (新版 4 类内容, 全新端口彻底避开 8787 老进程)
set "PORT=9090"
start "发稿器 9090 - 请勿关闭" /d "%~dp0" cmd /k "%NODE% tools\publish.cjs"

echo.
echo 等待服务就绪...
timeout /t 5 /nobreak >nul

start "" "http://localhost:8080"
start "" "http://localhost:9090"

echo.
echo ==========================================
echo   已启动完成
echo.
echo   站点：      http://localhost:8080
echo   发稿器：    http://localhost:9090  (新版 4 类，已替代老 author.cjs)
echo   写文章：    http://localhost:9090/write
echo.
echo   新弹出的两个窗口不要关闭，关掉服务就停了。
echo ==========================================
echo.
echo 本窗口 10 秒后自动关闭。
timeout /t 10 /nobreak >nul
exit /b 0

:nofile
echo.
echo [错误] 找不到 tools\serve.cjs 或 tools\publish.cjs
echo 当前目录：%CD%
echo.
pause
exit /b 1
