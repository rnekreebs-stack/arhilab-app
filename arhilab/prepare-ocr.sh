#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dest="${ARHILAB_OCR_DIR:-.ci-ocr}"
mkdir -p "$dest"
fetch() {
  local name="$1" url="$2" sha="$3"
  if [[ -f "$dest/$name" ]] && printf '%s  %s\n' "$sha" "$dest/$name" | sha256sum -c --status; then return; fi
  curl --fail --location --retry 3 --silent --show-error "$url" -o "$dest/$name.tmp"
  printf '%s  %s\n' "$sha" "$dest/$name.tmp" | sha256sum -c
  mv "$dest/$name.tmp" "$dest/$name"
}
fetch tesseract.aar https://jitpack.io/cz/adaptech/tesseract4android/tesseract4android/4.9.0/tesseract4android-4.9.0.aar bce5d6413a1a5ae3d7240033fbbc851ba3217d0a08d9769400e17a077f42cb2a
fetch rus.traineddata https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/rus.traineddata e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225
fetch eng.traineddata https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
unzip -p "$dest/tesseract.aar" classes.jar > "$dest/classes.jar"
