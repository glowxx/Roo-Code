@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Roo Code Desktop - Windows Installer Build
cd /d "%~dp0"

:: ---------------------------------------------------------
:: 0. Non-interactive / CI detection
:: ---------------------------------------------------------
set "IS_NON_INTERACTIVE=0"
if /i "%CI%"=="true" set "IS_NON_INTERACTIVE=1"
if "%CI%"=="1" set "IS_NON_INTERACTIVE=1"
if "%NON_INTERACTIVE%"=="1" set "IS_NON_INTERACTIVE=1"
if /i "%~1"=="--ci" set "IS_NON_INTERACTIVE=1"
if /i "%~1"=="--non-interactive" set "IS_NON_INTERACTIVE=1"

:: Native check for Node.js before invoking any helper
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js 20+ from https://nodejs.org/
    if "%IS_NON_INTERACTIVE%"=="0" pause
    exit /b 1
)

:: Header
node scripts/build-timer.mjs header

:: ---------------------------------------------------------
:: [1/5] Prerequisites
:: ---------------------------------------------------------
set "CURRENT_STAGE=1"
set "FAILED_CMD=Check prerequisites"
node scripts/build-timer.mjs start 1 "Prerequisites"

set "FAILED_CMD=where pnpm"
where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] pnpm is not found in PATH!
    echo Please install pnpm: npm install -g pnpm
    goto :fail_stage
)

:: Check icon freshness (regenerate only if missing or png is newer)
set "FAILED_CMD=Check / regenerate icon"
node scripts/build-timer.mjs check-icon
if %ERRORLEVEL% neq 0 (
    where python >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        python -c "from PIL import Image; img = Image.open('apps/desktop/assets/icon.png').resize((256, 256), Image.Resampling.LANCZOS); img.save('apps/desktop/assets/icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])" >nul 2>&1
        if %ERRORLEVEL% equ 0 (
            echo [ICON] Icon regenerated successfully.
        ) else (
            echo [WARNING] Python Pillow error. Using existing icon.ico.
        )
    ) else (
        echo [WARNING] Python not found in PATH. Using existing icon.ico.
    )
)

node scripts/build-timer.mjs pass 1 "Prerequisites"

:: ---------------------------------------------------------
:: [2/5] Internal packages
:: ---------------------------------------------------------
set "CURRENT_STAGE=2"
node scripts/build-timer.mjs start 2 "Internal packages"

set "FAILED_CMD=pnpm --filter @roo-code/build build"
call pnpm --filter @roo-code/build build
if %ERRORLEVEL% neq 0 goto :fail_stage

set "FAILED_CMD=pnpm --filter @roo-code/types build"
call pnpm --filter @roo-code/types build
if %ERRORLEVEL% neq 0 goto :fail_stage

node scripts/build-timer.mjs pass 2 "Internal packages"

:: ---------------------------------------------------------
:: [3/5] Desktop application
:: ---------------------------------------------------------
set "CURRENT_STAGE=3"
node scripts/build-timer.mjs start 3 "Desktop application"

set "FAILED_CMD=pnpm --filter @roo-code/desktop build"
call pnpm --filter @roo-code/desktop build
if %ERRORLEVEL% neq 0 goto :fail_stage

node scripts/build-timer.mjs pass 3 "Desktop application"

:: ---------------------------------------------------------
:: [4/5] Windows packaging
:: ---------------------------------------------------------
set "CURRENT_STAGE=4"
node scripts/build-timer.mjs start 4 "Windows packaging"

set "FAILED_CMD=pnpm --filter @roo-code/desktop package:win:builder"
call pnpm --filter @roo-code/desktop package:win:builder
if %ERRORLEVEL% neq 0 goto :fail_stage

node scripts/build-timer.mjs pass 4 "Windows packaging"

:: ---------------------------------------------------------
:: [5/5] Artifacts
:: ---------------------------------------------------------
set "CURRENT_STAGE=5"
set "FAILED_CMD=Copy release artifacts"
node scripts/build-timer.mjs start 5 "Artifacts"

if not exist "release" mkdir release
copy /y "apps\desktop\release\Roo Code Setup *.exe" "release\" >nul 2>&1
copy /y "apps\desktop\release\*.blockmap" "release\" >nul 2>&1

node scripts/build-timer.mjs pass 5 "Artifacts"

:: ---------------------------------------------------------
:: Final Summary
:: ---------------------------------------------------------
node scripts/build-timer.mjs summary

if "%IS_NON_INTERACTIVE%"=="0" pause
exit /b 0

:: ---------------------------------------------------------
:: Error Handler
:: ---------------------------------------------------------
:fail_stage
set "ERR_CODE=%ERRORLEVEL%"
if "%ERR_CODE%"=="" set "ERR_CODE=1"
if "%ERR_CODE%"=="0" set "ERR_CODE=1"
node scripts/build-timer.mjs fail !CURRENT_STAGE! "!FAILED_CMD!" !ERR_CODE!
if "%IS_NON_INTERACTIVE%"=="0" pause
exit /b !ERR_CODE!
