@echo off
cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

echo Killing any process on port 5599...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5599 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)
timeout /t 1 /nobreak >nul

echo Starting Bifrost at http://localhost:5599 ...
echo.
call npm run dev
