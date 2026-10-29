#!/bin/bash
# Master: glue compression, gain to -16 LUFS (ASMR keeps its transients), then an oversampled limiter so the
# delivered AAC stays at or below -1 dBTP (AAC adds ~0.5 dB of overshoot).
set -e
cd "$(dirname "$0")/audio"
pre="acompressor=threshold=-24dB:ratio=2.5:attack=25:release=120:makeup=1,alimiter=limit=0.92:attack=2:release=60:level=false"
lim="aresample=192000,alimiter=limit=0.80:attack=1:release=50:level=false,aresample=48000"
lufs() { ffmpeg -hide_banner -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+I:" | tail -1 | awk '{print $2}'; }
for name in mix music; do
  src=${name}_raw.wav
  gain=0
  for pass in 1 2 3; do
    ffmpeg -hide_banner -loglevel error -y -i $src -af "$pre,volume=${gain}dB,$lim" -ar 48000 -c:a pcm_s24le ${name}.wav
    i=$(lufs ${name}.wav)
    gain=$(python3 -c "print(round($gain + (${TARGET:--16.0} - ($i)), 2))")
  done
done
for f in mix music; do printf "%-6s " $f; ffmpeg -hide_banner -nostats -i $f.wav -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|Peak:)" | tr -s ' ' | tr '\n' ' '; echo; done
