#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p output
adb install -r output/upgrade-baseline-0.6.2-debug.apk
adb install -r arhilab/build/smoke/smoke.apk
adb shell pm clear ru.arhilab.estimate
adb logcat -c
adb shell am instrument -w -e mode upgradePrepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-upgrade-prepare.txt
grep -q ARHILAB_UPGRADE_PREPARE_PASS output/android-upgrade-prepare.txt
adb shell am force-stop ru.arhilab.estimate
adb install -r output/Arhilab-Смета-0.7.0-F6-debug.apk | tee output/android-upgrade-install.txt
grep -q Success output/android-upgrade-install.txt
adb shell am instrument -w -e mode upgradeVerify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-upgrade-verify.txt
grep -q ARHILAB_UPGRADE_PASS output/android-upgrade-verify.txt
for restart in 1 2; do
  adb shell am force-stop ru.arhilab.estimate
  adb shell am instrument -w -e mode upgradeRestart ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee "output/android-upgrade-restart-$restart.txt"
  grep -q ARHILAB_UPGRADE_RESTART_PASS "output/android-upgrade-restart-$restart.txt"
done
# A separate clean-install scenario starts after the in-place upgrade assertions passed.
adb uninstall ru.arhilab.estimate
adb install output/Arhilab-Смета-0.7.0-F6-debug.apk
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
adb shell dumpsys connectivity | grep -m1 'mAirplaneMode=true' > output/android-offline-state.txt || adb shell settings get global airplane_mode_on > output/android-offline-state.txt
adb shell am instrument -w ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-smoke.txt
grep -q ARHILAB_SMOKE_PASS output/android-smoke.txt
adb shell am force-stop ru.arhilab.estimate
adb shell am start -W -n ru.arhilab.estimate/.MainActivity | tee output/android-cold-start.txt
sleep 3
adb shell pidof ru.arhilab.estimate
adb shell am instrument -w -e resume true ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-restart-smoke.txt
grep -q ARHILAB_SMOKE_PASS output/android-restart-smoke.txt
echo 'Offline smoke and cold restart passed with airplane mode enabled' > output/android-offline-result.txt
adb shell run-as ru.arhilab.estimate ls -l files/data.enc | tee output/android-database.txt
adb logcat -d -s AndroidRuntime > output/android-crash-log.txt
if grep -q 'FATAL EXCEPTION' output/android-crash-log.txt; then exit 1; fi
adb exec-out screencap -p > output/android-final.png
if [[ -f output/upgrade-baseline-0.6.2-release.apk ]]; then
  # New isolated signing track. Its 0.6.2 -> 0.7.0 transition never uninstalls the baseline.
  adb uninstall ru.arhilab.estimate
  adb uninstall ru.arhilab.estimate.smoke
  adb install output/upgrade-baseline-0.6.2-release.apk
  adb install arhilab/build/smoke/release-smoke.apk
  adb shell am instrument -w -e mode upgradePrepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-release-upgrade-prepare.txt
  grep -q ARHILAB_UPGRADE_PREPARE_PASS output/android-release-upgrade-prepare.txt
  adb shell am force-stop ru.arhilab.estimate
  adb install -r output/Arhilab-Смета-0.7.0-F6-release.apk | tee output/android-release-upgrade-install.txt
  grep -q Success output/android-release-upgrade-install.txt
  adb shell am instrument -w -e mode upgradeVerify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-release-upgrade-verify.txt
  grep -q ARHILAB_UPGRADE_PASS output/android-release-upgrade-verify.txt
  adb shell am force-stop ru.arhilab.estimate
  adb shell am instrument -w -e mode upgradeRestart ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-release-upgrade-restart.txt
  grep -q ARHILAB_UPGRADE_RESTART_PASS output/android-release-upgrade-restart.txt
fi
