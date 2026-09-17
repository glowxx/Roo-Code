@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Roo Code Desktop

echo ====================================================
echo             ⚡ Roo Code Desktop Launcher ⚡
echo ====================================================
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not found in PATH!
    echo Please install Node.js 20+ from https://nodejs.org/
    pause
    exit /b 1
)

:: Check pnpm
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] pnpm is not installed or not found in PATH!
    echo Please install pnpm: npm install -g pnpm
    pause
    exit /b 1
)

:: Ensure desktop package is built
if not exist "%~dp0apps\desktop\dist\main\index.js" (
    echo [*] First run detected: Building Roo Code Desktop...
    call pnpm --filter @roo-code/build build
    call pnpm --filter @roo-code/types build
    call pnpm --filter @roo-code/vscode-shim build
    call pnpm --filter @roo-code/desktop build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Build failed! Check terminal output above.
        pause
        exit /b %ERRORLEVEL%
    )
    echo.
)

:: If arguments were provided on command line, pass them directly
if not "%~1"=="" (
    echo [*] Launching with arguments: %*
    cd /d "%~dp0"
    call pnpm --filter @roo-code/desktop start -- %*
    exit /b %ERRORLEVEL%
)

:: Interactive menu
echo Select launch mode:
echo   [1] Native Electron Desktop Application (Recommended)
echo   [2] Web Desktop (Runs local server and opens in default browser)
echo   [3] Development Mode (Live reloads and verbose logs)
echo   [4] Build Windows Installer (.exe)
echo   [5] Exit
echo.

set /p CHOICE="Enter choice [1-5] (default is 1): "
if "%CHOICE%"=="" set CHOICE=1

if "%CHOICE%"=="1" (
    echo.
    echo [*] Starting Roo Code Desktop (Native Electron Window)...
    cd /d "%~dp0"
    call pnpm --filter @roo-code/desktop start
) else if "%CHOICE%"=="2" (
    echo.
    echo [*] Starting Roo Code Web Desktop...
    cd /d "%~dp0"
    call pnpm --filter @roo-code/desktop web
) else if "%CHOICE%"=="3" (
    echo.
    echo [*] Starting in Development Mode...
    cd /d "%~dp0"
    call pnpm --filter @roo-code/desktop dev
) else if "%CHOICE%"=="4" (
    echo.
    echo [*] Launching Installer Builder...
    cd /d "%~dp0"
    call build_win_installer.bat
) else (
    echo Exiting...
    exit /b 0
)
