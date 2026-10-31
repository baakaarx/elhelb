@echo off
chcp 65001 >nul
title ELHELB GROUP — Boards Server (Production)
cd /d "%~dp0"

echo ========================================================
echo   ELHELB GROUP — منصة ادارة المهام واللوحات الرسمية
echo ========================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] يرجى تثبيت Node.js 22 LTS اولا من https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] جاري تثبيت حزم السيرفر لاول مرة...
  call npm ci --omit=dev --no-fund --loglevel=error
)

if not exist "data" mkdir "data"

if "%JWT_SECRET%"=="" (
  if not exist "data\.jwt_secret" (
    echo [2/3] جاري توليد مفتاح تشفير الجلسات الفريد للسيرفر...
    node -e "require('fs').writeFileSync('data\\.jwt_secret', require('crypto').randomBytes(48).toString('hex'), { mode: 0o600 })"
  )
  set /p JWT_SECRET=<"data\.jwt_secret"
)

set NODE_ENV=production
set HOST=0.0.0.0
if "%PORT%"=="" set PORT=3000
if "%TRUST_PROXY%"=="" set TRUST_PROXY=0
if "%DB_PATH%"=="" set DB_PATH=%~dp0data\elhelb-boards.db

echo [3/3] جاري تشغيل السيرفر على المنفذ %PORT% ...
echo [DB]  مسار قاعدة البيانات الدائم: %DB_PATH%
node --no-warnings server/index.js
pause
