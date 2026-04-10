@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo [1/3] 正在从飞书同步数据...
node generate.mjs
if %errorlevel% neq 0 (
  echo 错误：数据同步失败，请检查飞书授权或网络连接
  pause
  exit /b 1
)

echo [2/3] 提交更新...
git add index.html
git commit -m "Data sync %date% %time%"
if %errorlevel% neq 0 (
  echo 提示：没有数据变更，无需提交
  pause
  exit /b 0
)

echo [3/3] 推送到 GitHub Pages...
git push
if %errorlevel% neq 0 (
  echo 错误：推送失败，请检查网络或 Git 权限
  pause
  exit /b 1
)

echo.
echo 同步完成！网页将在约 1 分钟内更新。
pause
