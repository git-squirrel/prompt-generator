@echo off
title Prompt Generator Server
cd /d "%~dp0"
echo ==============================
echo   Prompt Generator HTTP Server
echo ==============================
echo.
echo   Default port: 8080
echo   Edit server_config.json to change port/address
echo.
echo   Server starting...
echo   Open http://127.0.0.1:8080 in your browser
echo   Close this window to stop the server
echo.

python start_server.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to start. Make sure Python is installed.
    pause
)
