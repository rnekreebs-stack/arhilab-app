#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p output
adb install -r output/Arhilab-SM-0.6.0-debug.apk
adb install -r arhilab/build/smoke/smoke.apk
adb shell pm clear ru.arhilab.estimate
adb logcat -c
adb shell am instrument -w ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-smoke.txt
grep -q ARHILAB_SMOKE_PASS output/android-smoke.txt
adb shell am force-stop ru.arhilab.estimate
adb shell am start -W -n ru.arhilab.estimate/.MainActivity | tee output/android-cold-start.txt
sleep 3
adb shell pidof ru.arhilab.estimate
adb shell am instrument -w -e resume true ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-restart-smoke.txt
grep -q ARHILAB_SMOKE_PASS output/android-restart-smoke.txt
adb shell run-as ru.arhilab.estimate ls -l files/data.enc | tee output/android-database.txt
adb logcat -d -s AndroidRuntime > output/android-crash-log.txt
if grep -q 'FATAL EXCEPTION' output/android-crash-log.txt; then exit 1; fi
adb exec-out screencap -p > output/android-final.png
