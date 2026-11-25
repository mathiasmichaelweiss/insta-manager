#!/bin/bash
cd "$(dirname "$0")"
PORT=3000
if lsof -i :$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Уже запущено: http://localhost:$PORT"
  open "http://localhost:$PORT"
  exit 0
fi
[ -d node_modules ] || npm install
(sleep 6; open "http://localhost:$PORT") &
npm run dev -- -p $PORT
