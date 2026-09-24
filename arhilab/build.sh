#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
variant="${1:-debug}"
[[ "$variant" == debug || "$variant" == release ]] || { echo 'Usage: build.sh [debug|release]' >&2; exit 2; }
: "${ANDROID_SDK_ROOT:=${ANDROID_HOME:-}}"
: "${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT}"
: "${JAVA_HOME:?Set JAVA_HOME to JDK 17}"
export PATH="$JAVA_HOME/bin:$PATH"
[[ -x "$JAVA_HOME/bin/javac" ]] || { echo 'JDK compiler javac is missing' >&2; exit 2; }
BT="$ANDROID_SDK_ROOT/build-tools/35.0.0"
AJAR="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"
[[ -f "$AJAR" && -x "$BT/aapt2" ]] || { echo 'Install platforms;android-35 and build-tools;35.0.0' >&2; exit 2; }
BUILD="build/$variant"
rm -rf "$BUILD"
mkdir -p "$BUILD/classes" ../output
javac -encoding UTF-8 -source 8 -target 8 -classpath "$AJAR" -d "$BUILD/classes" src/ru/arhilab/estimate/*.java
find "$BUILD/classes" -name '*.class' | sort > "$BUILD/class-list.txt"
"$BT/d8" --lib "$AJAR" --min-api 26 --output "$BUILD" @"$BUILD/class-list.txt"
"$BT/aapt2" compile --dir res -o "$BUILD/res.zip"
python3 - "$variant" "$BUILD" <<'PY'
import sys, pathlib, xml.etree.ElementTree as ET
variant, build = sys.argv[1:]
p=pathlib.Path('AndroidManifest.xml');root=ET.fromstring(p.read_text());a='{http://schemas.android.com/apk/res/android}'
assert root.attrib['package']=='ru.arhilab.estimate'
assert root.attrib[a+'versionName']=='0.6.1' and root.attrib[a+'versionCode']=='8'
ET.register_namespace('android',a[1:-1]);root.find('application').set(a+'debuggable','true' if variant=='debug' else 'false')
ET.ElementTree(root).write(pathlib.Path(build)/'AndroidManifest.xml',encoding='utf-8',xml_declaration=True)
PY
"$BT/aapt2" link -o "$BUILD/base.apk" -I "$AJAR" --manifest "$BUILD/AndroidManifest.xml" -A assets "$BUILD/res.zip"
python3 - "$BUILD" <<'PY'
import sys,zipfile
b=sys.argv[1]
with zipfile.ZipFile(b+'/base.apk','a',zipfile.ZIP_DEFLATED) as z:z.write(b+'/classes.dex','classes.dex')
PY
"$BT/zipalign" -f -p 4 "$BUILD/base.apk" "$BUILD/aligned.apk"
if [[ "$variant" == debug ]]; then
  SIGNING_KEYSTORE="$(pwd)/build/debug.keystore"
  if [[ ! -f "$SIGNING_KEYSTORE" ]]; then
    keytool -genkeypair -keystore "$SIGNING_KEYSTORE" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US' >/dev/null 2>&1
  fi
  export SIGNING_STORE_PASSWORD=android SIGNING_KEY_PASSWORD=android
  SIGNING_KEY_ALIAS=androiddebugkey
else
  : "${SIGNING_KEYSTORE:?Release requires signing keystore path}"
  : "${SIGNING_STORE_PASSWORD:?Release requires SIGNING_STORE_PASSWORD}"
  : "${SIGNING_KEY_ALIAS:=arhilab}"
  export SIGNING_KEY_PASSWORD="${SIGNING_KEY_PASSWORD:-$SIGNING_STORE_PASSWORD}"
fi
APK="../output/Arhilab-Смета-0.6.1-$variant.apk"
"$BT/apksigner" sign --ks "$SIGNING_KEYSTORE" --ks-key-alias "$SIGNING_KEY_ALIAS" --ks-pass env:SIGNING_STORE_PASSWORD --key-pass env:SIGNING_KEY_PASSWORD --out "$APK" "$BUILD/aligned.apk"
"$BT/apksigner" verify --verbose --print-certs "$APK" > "$APK.signature.txt"
if [[ "$variant" == release ]]; then
  grep -qi '21bda2218d2b3c9ffece2379ee03c779227c66d729f5e87afffde05887c75410' "$APK.signature.txt" || { rm -f "$APK"; echo 'Release certificate differs from original Arhilab signer' >&2; exit 1; }
fi
"$BT/aapt2" dump badging "$APK" > "$APK.metadata.txt"
python3 - "$APK" <<'PY'
import sys,pathlib,zipfile,json,hashlib
p=pathlib.Path(sys.argv[1]);assert p.stat().st_size>0
info=pathlib.Path(str(p)+'.metadata.txt').read_text()
assert "name='ru.arhilab.estimate'" in info and "versionName='0.6.1'" in info and "versionCode='8'" in info
with zipfile.ZipFile(p) as z:
 c=json.loads(z.read('assets/catalog.json'));assert len(c['materials'])==254
 assert len(c['works'])==371 and sum(bool(w['tiers']['standard']['materialIds']) for w in c['works'])==110
p.with_suffix('.sha256').write_text(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n')
print('Verified:',p,'bytes:',p.stat().st_size,'package ru.arhilab.estimate, version 0.6.1 (8), 254 SKU')
PY
