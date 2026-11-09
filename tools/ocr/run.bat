@echo off
setlocal
cd /d "%~dp0"

rem OCR service launcher.
rem The OCR dependencies live in a project-local Python env, not the system Python,
rem so plain "python ocr_service.py" fails with ModuleNotFoundError.
rem Paths are built from env vars on purpose: this folder's path contains non-ASCII
rem characters, and hardcoding it inside a .bat would risk encoding corruption.

set "PY=%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe"

if not exist "%PY%" (
  echo [!] Project Python environment not found:
  echo     %PY%
  echo.
  echo Either install deps into your current Python:
  echo     pip install rapidocr-onnxruntime
  echo or recreate that environment.
  echo.
  pause
  exit /b 1
)

echo Using interpreter: %PY%
echo.

"%PY%" ocr_service.py %*

echo.
echo [Exited] Press any key to close this window.
pause >nul
