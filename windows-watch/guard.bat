@echo off
rem Steadfast Watch - Windows guard. Run from an admin terminal:
rem   guard.bat link    link your account
rem   guard.bat on      protect this machine (sets DNS to 127.0.0.1)
rem   guard.bat off     restore normal DNS
rem   guard.bat status  show link/open state
cd /d "%~dp0"
python guard.py %*