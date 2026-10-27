@echo off
rem One-line installer for Anubis-Security-Tool web (build from source, Windows).
rem Optional env vars:
rem   ANUBIS_REPO_URL  git url (default https://github.com/Anubis-Security-Tool/anubis-web.git)
rem   ANUBIS_REF       branch/tag (default: repo default branch)
rem   ANUBIS_DIR       target dir (default anubis-web)
rem   ANUBIS_MANAGED_URL gateway origin (default https://api.anubis.locker)
rem   ANUBIS_MANAGED_ACCESS=0 explicit standalone install (default managed)
setlocal EnableExtensions

if not defined ANUBIS_REPO_URL set "ANUBIS_REPO_URL=https://github.com/Anubis-Security-Tool/anubis-web.git"
if not defined ANUBIS_DIR set "ANUBIS_DIR=anubis-web"

where git >nul 2>&1 || (echo [anubis] ERROR: git is required. & exit /b 1)
where node >nul 2>&1 || (echo [anubis] ERROR: Node.js 24+ is required. & exit /b 1)
where npm >nul 2>&1 || (echo [anubis] ERROR: npm is required. & exit /b 1)

for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 24 (echo [anubis] ERROR: Node.js 24+ required, found major %NODE_MAJOR%. & exit /b 1)

if exist "%ANUBIS_DIR%\.git" (
  git -C "%ANUBIS_DIR%" diff --quiet || (echo [anubis] ERROR: preserve local tracked edits before updating. & exit /b 1)
  git -C "%ANUBIS_DIR%" diff --cached --quiet || (echo [anubis] ERROR: preserve staged edits before updating. & exit /b 1)
  echo [anubis] updating existing checkout in %ANUBIS_DIR%
  git -C "%ANUBIS_DIR%" fetch --tags --prune origin || (echo [anubis] ERROR: git fetch failed. & exit /b 1)
  if defined ANUBIS_REF (
    git -C "%ANUBIS_DIR%" checkout "%ANUBIS_REF%" || (echo [anubis] ERROR: checkout failed. & exit /b 1)
  ) else (
    git -C "%ANUBIS_DIR%" pull --ff-only || (echo [anubis] ERROR: cannot fast-forward; resolve the checkout before updating. & exit /b 1)
  )
) else if exist "%ANUBIS_DIR%" (
  echo [anubis] ERROR: %ANUBIS_DIR% exists and is not a git checkout; set ANUBIS_DIR. & exit /b 1
) else (
  echo [anubis] cloning %ANUBIS_REPO_URL%
  if defined ANUBIS_REF (
    git clone --depth 1 --branch "%ANUBIS_REF%" "%ANUBIS_REPO_URL%" "%ANUBIS_DIR%" || (echo [anubis] ERROR: clone failed. & exit /b 1)
  ) else (
    git clone --depth 1 "%ANUBIS_REPO_URL%" "%ANUBIS_DIR%" || (echo [anubis] ERROR: clone failed. & exit /b 1)
  )
)

cd /d "%ANUBIS_DIR%" || (echo [anubis] ERROR: cannot enter %ANUBIS_DIR%. & exit /b 1)

node scripts\install-source.js || (echo [anubis] ERROR: source installation failed. & exit /b 1)

echo [anubis] done. Start with: cd %ANUBIS_DIR% ^&^& npm run managed   (local: http://127.0.0.1:5577)
echo [anubis] Web login credentials are stored in .env; first gateway fingerprint approval is required.
endlocal
exit /b 0
