#!/usr/bin/env bash
# GENESIS starten: Mini-Webserver + Browser öffnen
cd "$(dirname "$0")"
echo "🌍 GENESIS läuft auf http://localhost:8000"
echo "   (Ollama sollte laufen: ollama serve)"
( sleep 1; xdg-open http://localhost:8000 2>/dev/null || open http://localhost:8000 2>/dev/null ) &
python3 -m http.server 8000
