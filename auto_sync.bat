@echo off
chcp 65001 >nul
cd /d "D:\work\weekly-report"

echo [%date% %time%] 开始定时同步...

:: 拉取最新数据
node sync_sheet.mjs 2>> auto_sync.log
if %errorlevel% neq 0 (
  echo [%date% %time%] 数据拉取失败 >> auto_sync.log
  exit /b 1
)

:: 检查 index.html 是否有变化
git diff --quiet index.html
if %errorlevel% equ 0 (
  echo [%date% %time%] 数据无变化，跳过提交 >> auto_sync.log
  exit /b 0
)

:: 有变化则提交推送
git add index.html
git commit -m "Auto sync %date% %time%"
git push

if %errorlevel% equ 0 (
  echo [%date% %time%] 同步成功，已推送至 GitHub >> auto_sync.log
) else (
  echo [%date% %time%] 推送失败 >> auto_sync.log
  exit /b 1
)
