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
"$BT/apksigner" sign --ks "${SIGNING_KEYSTORE:?Persistent Debug keystore required}" --ks-key-alias androiddebugkey --ks-pass pass:android --out build/smoke/smoke.apk build/smoke/aligned.apk
