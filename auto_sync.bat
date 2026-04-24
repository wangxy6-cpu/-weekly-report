@echo off
chcp 65001 >nul
cd /d "D:\work\weekly-report"

set NODE="C:\Program Files\nodejs\node.exe"
set GIT="D:\Software\Git\cmd\git.exe"

echo [%date% %time%] 开始定时同步... >> auto_sync.log

:: 拉取最新数据
%NODE% sync_sheet.mjs >> auto_sync.log 2>&1
if %errorlevel% neq 0 (
  echo [%date% %time%] 数据拉取失败 >> auto_sync.log
  exit /b 1
)

:: 检查 index.html 是否有变化
%GIT% diff --quiet index.html
if %errorlevel% equ 0 (
  echo [%date% %time%] 数据无变化，跳过提交 >> auto_sync.log
  exit /b 0
)

:: 有变化则提交推送
%GIT% add index.html
%GIT% commit -m "Auto sync %date% %time%"
%GIT% push

if %errorlevel% equ 0 (
  echo [%date% %time%] 同步成功，已推送至 GitHub >> auto_sync.log
) else (
  echo [%date% %time%] 推送失败 >> auto_sync.log
  exit /b 1
)
