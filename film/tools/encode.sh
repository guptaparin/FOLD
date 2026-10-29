#!/bin/bash
# Encode rendered frames + master mix into the final film, plus a music-only version.
#   film/tools/encode.sh FRAMES_DIR OUT_DIR
set -e
FR=$1; OUT=$2; HERE=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$OUT"
# Frames are rendered at 0.75 internal resolution inside a 1920×1080 page; a light
# unsharp restores crispness lost in the upscale.
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i "$FR/f%04d.png" -i "$HERE/audio/mix.wav" \
  -vf "unsharp=5:5:0.45:5:5:0.0,format=yuv420p" -c:v libx264 -preset slow -crf 16 -profile:v high -tune film \
  -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart "$OUT/FOLD-film-16x9.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$HERE/audio/music.wav" -c:a aac -b:a 256k "$OUT/FOLD-film-music-only.m4a"
ffmpeg -hide_banner -loglevel error -y -i "$HERE/audio/music.wav" -c:a pcm_s24le "$OUT/FOLD-film-music-only.wav"
echo "encoded"
