#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
BT="$ANDROID_SDK_ROOT/build-tools/35.0.0"
AJAR="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"
mkdir -p build/smoke/classes
"$JAVA_HOME/bin/javac" -encoding UTF-8 -source 8 -target 8 -cp "$AJAR" -d build/smoke/classes tests/android/Smoke.java src/ru/arhilab/estimate/BackupCrypto.java
find build/smoke/classes -name '*.class' | sort > build/smoke/classes.txt
"$BT/d8" --lib "$AJAR" --min-api 26 --output build/smoke @build/smoke/classes.txt
"$BT/aapt2" link -o build/smoke/base.apk -I "$AJAR" --manifest tests/android/AndroidManifest.xml
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('build/smoke/base.apk','a',zipfile.ZIP_DEFLATED) as z:z.write('build/smoke/classes.dex','classes.dex')
PY
"$BT/zipalign" -f 4 build/smoke/base.apk build/smoke/aligned.apk
: "${SIGNING_KEYSTORE:?Signing keystore required}"
: "${SIGNING_STORE_PASSWORD:?Signing password required}"
: "${SIGNING_KEY_ALIAS:?Signing alias required}"
export SIGNING_KEY_PASSWORD="${SIGNING_KEY_PASSWORD:-$SIGNING_STORE_PASSWORD}"
"$BT/apksigner" sign --ks "$SIGNING_KEYSTORE" --ks-key-alias "$SIGNING_KEY_ALIAS" --ks-pass env:SIGNING_STORE_PASSWORD --key-pass env:SIGNING_KEY_PASSWORD --out build/smoke/smoke.apk build/smoke/aligned.apk
