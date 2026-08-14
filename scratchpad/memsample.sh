#!/bin/bash
OUT="$1"; N="${2:-12}"; INT="${3:-20}"
echo "ts,core_rss_mb,electron_rss_mb,total_rss_mb" > "$OUT"
for i in $(seq 1 $N); do
  CORE=$(for p in $(pgrep -f "ghost-render-core"); do ps -o rss= -p $p; done | awk '{s+=$1} END{printf "%.1f", s/1024}')
  ELEC=$(for p in $(pgrep -f "Electron.app/Contents/MacOS/Electron"); do ps -o rss= -p $p; done | awk '{s+=$1} END{printf "%.1f", s/1024}')
  [ -z "$CORE" ] && CORE=0; [ -z "$ELEC" ] && ELEC=0
  echo "$(date +%s),$CORE,$ELEC,$(echo "$CORE + $ELEC" | bc)" >> "$OUT"
  sleep $INT
done
