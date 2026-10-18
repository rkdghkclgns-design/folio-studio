@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo Folio 컴퓨터 연결을 준비합니다. Python 3.11 이상이 필요합니다.
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 goto failed
)
if not exist ".venv\.folio-deps-v1" (
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
  if errorlevel 1 goto failed
  echo ready>".venv\.folio-deps-v1"
)
".venv\Scripts\python.exe" folio_companion.py
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo 실행하지 못했습니다. 위 오류를 확인하세요. 관리자 권한으로 실행하지 마세요.
pause
exit /b 1
