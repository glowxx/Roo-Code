@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Roo Code Desktop - Windows Installer Builder

echo ====================================================
echo    📦 Roo Code Desktop - Windows Installer Builder 📦
echo ====================================================
echo.

cd /d "%~dp0"

:: 1. Check prerequisites
echo [1/6] Checking prerequisites...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] pnpm is not found in PATH!
    pause
    exit /b 1
)

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Python not found in PATH. Icon generation will use existing assets.
) else (
    python -c "from PIL import Image; img = Image.open('apps/desktop/assets/icon.png').resize((256, 256), Image.Resampling.LANCZOS); img.save('apps/desktop/assets/icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])" >nul 2>&1
)

:: 2. Build prerequisite packages
echo.
echo [2/6] Building internal packages (@roo-code/build, @roo-code/types, @roo-code/vscode-shim)...
call pnpm --filter @roo-code/build build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build @roo-code/build
    pause
    exit /b %ERRORLEVEL%
)

call pnpm --filter @roo-code/types build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build @roo-code/types
    pause
    exit /b %ERRORLEVEL%
)

call pnpm --filter @roo-code/vscode-shim build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build @roo-code/vscode-shim
    pause
    exit /b %ERRORLEVEL%
)

:: 3. Build Core Engine bundle
echo.
echo [3/6] Building core agent engine bundle (roo-cline bundle)...
call pnpm --filter roo-cline bundle
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to bundle core engine
    pause
    exit /b %ERRORLEVEL%
)

:: 4. Build React Webview UI
echo.
echo [4/6] Building React Webview UI (@roo-code/vscode-webview)...
call pnpm --filter @roo-code/vscode-webview build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build webview-ui
    pause
    exit /b %ERRORLEVEL%
)

:: 5. Build Desktop application & bundle assets
echo.
echo [5/6] Bundling Desktop application assets (@roo-code/desktop)...
call pnpm --filter @roo-code/desktop build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to build @roo-code/desktop
    pause
    exit /b %ERRORLEVEL%
)

:: 6. Package with electron-builder into NSIS installer
echo.
echo [6/6] Generating Windows NSIS Installer (.exe)...
call pnpm --filter @roo-code/desktop package:win
if %ERRORLEVEL% neq 0 (
    echo [ERROR] electron-builder packaging failed!
    pause
    exit /b %ERRORLEVEL%
)

:: Copy installer to root release directory for convenience
if not exist "release" mkdir release
copy /y "apps\desktop\release\Roo Code Setup *.exe" "release\" >nul 2>&1
copy /y "apps\desktop\release\*.blockmap" "release\" >nul 2>&1

echo.
echo ====================================================
echo  🎉 SUCCESS! Windows Installer successfully created! 🎉
echo ====================================================
echo.
echo Installer location:
echo   %~dp0release\
echo   %~dp0apps\desktop\release\
echo.
dir "%~dp0apps\desktop\release\Roo Code Setup *.exe"
echo.
echo You can run this installer on any Windows 10/11 x64 machine.
echo Future updates can simply be installed on top without losing settings.
echo ====================================================
echo.
pause
