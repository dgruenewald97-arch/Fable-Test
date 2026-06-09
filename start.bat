@echo off
cd /d "%~dp0"
echo 🌍 GENESIS laeuft auf http://localhost:8000
echo    (Ollama sollte laufen)
start http://localhost:8000
python -m http.server 8000
