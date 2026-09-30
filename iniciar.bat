@echo off
rem Abre o Andromeda Galaxy no navegador usando um mini servidor local (nao instala nada).
rem Os modulos JavaScript nao carregam com o index.html aberto direto do disco.
rem Opcional (prompt de comando): iniciar.bat -Quality ultra   (ou high, medium, low)
title Andromeda Galaxy - servidor local
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\servidor.ps1" %*
if errorlevel 1 pause
