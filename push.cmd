@echo off
REM Runs push.ps1 without touching the machine execution policy.
REM Windows refuses .ps1 by default; -ExecutionPolicy Bypass applies to
REM this one process and nothing else. Arguments pass straight through:
REM   push -Branch snapshot/0.5.30
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0push.ps1" %*
exit /b %ERRORLEVEL%
