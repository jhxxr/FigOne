@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "EEG_PY=C:\Users\24717\.conda\envs\eeg\python.exe"
if not exist "%EEG_PY%" (
  echo [ERROR] eeg python not found: %EEG_PY%
  pause
  exit /b 1
)

set "AUTOFIGURE_PYTHON=%EEG_PY%"
set "SAM3_CHECKPOINT=%~dp0..\..\FigOne-model\sam3.pt"
if not exist "%SAM3_CHECKPOINT%" set "SAM3_CHECKPOINT=%~dp0..\..\Figra-model\sam3.pt"
if not exist "%SAM3_CHECKPOINT%" set "SAM3_CHECKPOINT=%~dp0..\..\..\FigOne-model\sam3.pt"
set "KMP_DUPLICATE_LIB_OK=TRUE"
set "PYTHONUNBUFFERED=1"
set "HF_HOME=%CD%\hf_cache"
rem Make the checked-out SAM3 source importable even before its editable install is refreshed.
set "PYTHONPATH=%CD%\sam3-src;%PYTHONPATH%"

echo [INFO] Starting server with eeg Python...
echo [INFO] AUTOFIGURE_PYTHON=%AUTOFIGURE_PYTHON%
echo [INFO] SAM3_CHECKPOINT=%SAM3_CHECKPOINT%
echo [INFO] Server will listen on :8000

"%EEG_PY%" -m uvicorn server:app --host 0.0.0.0 --port 8000 --no-access-log --log-level info
pause
