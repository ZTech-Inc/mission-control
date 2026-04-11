@echo off
setlocal
set "OPENCLAW_REPO=D:\ZTech Inc\openclaw"
if not exist "%OPENCLAW_REPO%\openclaw.mjs" (
  echo openclaw.mjs not found at "%OPENCLAW_REPO%\openclaw.mjs" 1>&2
  exit /b 1
)
node "%OPENCLAW_REPO%\openclaw.mjs" %*

