#!/usr/bin/env bash
# Re-encode every public/ video into video-compressed/, mirroring the paths.
# Originals are never touched. video-compressed/ is gitignored, so nothing is
# committed or deployed until the results are compared and swapped in.
#
# CRF 26 with a slow preset: the source clips are mostly short and encoded at
# absurd bitrates (one 6-second 1152px clip sits at 32 Mbps), so the saving
# comes from the bitrate, not from scaling. Resolutions are left alone.
# +faststart moves the index to the front so playback can begin while
# downloading, which matters for autoplay backgrounds.
set -uo pipefail

SRC="public"
OUT="video-compressed"
LOG="$OUT/_report.tsv"

mkdir -p "$OUT"
printf 'file\tbefore_bytes\tafter_bytes\tsaved_pct\n' > "$LOG"

total_before=0
total_after=0
n=0
failed=0

while IFS= read -r -d '' f; do
  rel="${f#$SRC/}"
  dest="$OUT/$rel"
  mkdir -p "$(dirname "$dest")"
  n=$((n + 1))
  echo "[$n] $rel"

  if ! ffmpeg -nostdin -v error -y -i "$f" \
      -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p \
      -c:a aac -b:a 128k \
      -movflags +faststart \
      "$dest" 2>>"$OUT/_errors.log"; then
    echo "    BASARISIZ — atlandi"
    failed=$((failed + 1))
    rm -f "$dest"
    continue
  fi

  before=$(stat -c%s "$f")
  after=$(stat -c%s "$dest")
  total_before=$((total_before + before))
  total_after=$((total_after + after))
  pct=$(( before > 0 ? (100 - after * 100 / before) : 0 ))
  printf '%s\t%s\t%s\t%s\n' "$rel" "$before" "$after" "$pct" >> "$LOG"
  echo "    $((before / 1024 / 1024))MB -> $((after / 1024 / 1024))MB  (%$pct kuculdu)"
done < <(find "$SRC" -type f -name '*.mp4' -print0)

echo
echo "==================== OZET ===================="
echo "islenen dosya : $n"
echo "basarisiz     : $failed"
echo "once          : $((total_before / 1024 / 1024)) MB"
echo "sonra         : $((total_after / 1024 / 1024)) MB"
if [ "$total_before" -gt 0 ]; then
  echo "kazanc        : %$((100 - total_after * 100 / total_before))"
fi
echo "rapor         : $LOG"
