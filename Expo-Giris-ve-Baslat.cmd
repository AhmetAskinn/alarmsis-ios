@echo off
setlocal
cd /d "%~dp0"

if not exist ".\node_modules\.bin\expo.cmd" (
  echo Expo dependencies are missing. Run npm.cmd install in this folder first.
  pause
  exit /b 1
)

for /f "delims=" %%I in ('node.exe -e "const os=require('os');const ip=Object.values(os.networkInterfaces()).flat().find(a=>a.family==='IPv4'&&!a.internal&&!a.address.startsWith('169.254.'));if(ip)process.stdout.write(ip.address)"') do set "REACT_NATIVE_PACKAGER_HOSTNAME=%%I"

echo A browser will open so you can sign in to your Expo account.
echo Do not share your password or one-time security code with anyone.
call ".\node_modules\.bin\expo.cmd" login
if errorlevel 1 goto login_failed

echo.
echo Starting Alertify. Keep this window open and scan the QR code in Expo Go.
call ".\node_modules\.bin\expo.cmd" start --lan
if errorlevel 1 goto start_failed
goto end

:login_failed
echo Expo sign-in did not finish. Close this window and try again.
pause
exit /b 1

:start_failed
echo Expo could not start. Check the message above.
pause
exit /b 1

:end
endlocal
