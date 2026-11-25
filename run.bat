@echo off
setlocal
cd /d "%~dp0"

REM ---- find a REAL Python (the Microsoft Store "python" shortcut does not count)
set "PY="
python --version >nul 2>nul && set "PY=python"
if not defined PY ( py -3 --version >nul 2>nul && set "PY=py -3" )
if not defined PY goto :nopython
%PY% -c "import sys; sys.exit(0 if sys.version_info>=(3,9) else 1)" >nul 2>nul
if errorlevel 1 goto :nopython

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo !! Node.js is not installed. Install the LTS version from https://nodejs.org then run this script again.
  pause
  exit /b 1
)

if not exist frontend\node_modules (
  echo ^>^> Installing dashboard packages ^(one time, about 1 minute^)...
  pushd frontend
  call npm install --no-audit --no-fund
  popd
)

start "Peerloom node (API 8801)" cmd /k "cd backend && %PY% -m peerloom --api-port 8801"
call :waitapi 8801
if errorlevel 1 goto :apifail
start "Peerloom dashboard (3000)" cmd /k "cd frontend && npm run dev"
echo.
echo Dashboard: http://localhost:3000   ^(opening in a few seconds^)
timeout /t 8 >nul
start http://localhost:3000
endlocal
exit /b 0

:waitapi
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 25;$i++){ try { $r=Invoke-RestMethod http://127.0.0.1:%1/api/health -TimeoutSec 1; if($r.ok){$ok=$true;break} } catch {}; Start-Sleep 1 }; if($ok){exit 0}else{exit 1}"
exit /b %errorlevel%

:apifail
echo.
echo !! A Peerloom node did not start. Look at its window for the red error text.
echo    Common cause: the API port is already used by another program.
pause
exit /b 1

:nopython
echo.
echo !! Python 3.9 or newer was not found on this computer.
echo    1. Download Python from https://www.python.org/downloads/
echo    2. In the installer TICK "Add python.exe to PATH", then click Install Now
echo    3. Close this terminal, open a new one and run this script again
echo    (Or run:  winget install Python.Python.3.12 )
pause
exit /b 1
