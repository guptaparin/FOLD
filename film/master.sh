#!/bin/bash
# Master: gentle glue compression, then two-pass EBU R128 loudnorm to -14 LUFS / -1 dBTP.
set -e
cd "$(dirname "$0")/audio"
for name in mix music; do
  src=${name}_raw.wav
  pre="acompressor=threshold=-24dB:ratio=2.5:attack=8:release=120:makeup=1,alimiter=limit=0.78:attack=2:release=60:level=false"
  stats=$(ffmpeg -hide_banner -nostats -i $src -af "$pre,loudnorm=I=-14:TP=-2:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
  mi=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_i'])")
  mtp=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_tp'])")
  mlra=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_lra'])")
  mth=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_thresh'])")
  off=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['target_offset'])")
  ffmpeg -hide_banner -loglevel error -y -i $src -af "$pre,loudnorm=I=-14:TP=-2:LRA=11:measured_I=$mi:measured_TP=$mtp:measured_LRA=$mlra:measured_thresh=$mth:offset=$off:linear=true" -ar 48000 -c:a pcm_s24le ${name}.wav
done
for f in mix music; do printf "%-6s " $f; ffmpeg -hide_banner -nostats -i $f.wav -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|Peak:)" | tr -s ' ' | tr '\n' ' '; echo; done
