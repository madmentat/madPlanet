@echo off
REM Runs deploy-from-github.ps1 without touching the machine execution policy.
REM Windows refuses .ps1 by default; -ExecutionPolicy Bypass applies to
REM this one process and nothing else. Arguments pass straight through:
REM   deploy-from-github -Branch snapshot/0.5.30
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-from-github.ps1" %*
exit /b %ERRORLEVEL%
