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
adb install -r output/Arhilab-Смета-0.8.0-alpha4-debug.apk | tee output/android-upgrade-install.txt
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
adb install output/Arhilab-Смета-0.8.0-alpha4-debug.apk
adb shell am instrument -w -e mode loginScreenshot ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-a3-login.txt
grep -q ARHILAB_A3_LOGIN_PASS output/android-a3-login.txt
adb exec-out run-as ru.arhilab.estimate cat files/ui08-login.png > output/ui08-login.png
test -s output/ui08-login.png
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
adb shell am instrument -w -e mode lifecyclePrepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-lifecycle-prepare.txt
grep -q ARHILAB_LIFECYCLE_PREPARE_PASS output/android-lifecycle-prepare.txt
adb shell am force-stop ru.arhilab.estimate
adb shell am instrument -w -e mode lifecycleArchived ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-lifecycle-archived.txt
grep -q ARHILAB_LIFECYCLE_ARCHIVED_PASS output/android-lifecycle-archived.txt
adb shell am force-stop ru.arhilab.estimate
adb shell am instrument -w -e mode lifecycleDeleted ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-lifecycle-deleted.txt
grep -q ARHILAB_LIFECYCLE_DELETED_PASS output/android-lifecycle-deleted.txt
adb shell run-as ru.arhilab.estimate ls -l files/data.enc | tee output/android-database.txt
adb logcat -d -s AndroidRuntime > output/android-crash-log.txt
if grep -q 'FATAL EXCEPTION' output/android-crash-log.txt; then exit 1; fi
adb exec-out screencap -p > output/android-final.png
# Separate F6 -> F7 in-place upgrade track; no uninstall or clear between these two APKs.
adb uninstall ru.arhilab.estimate
adb shell cmd connectivity airplane-mode disable
adb install output/upgrade-baseline-f6-debug.apk
adb shell am instrument -w -e mode f6Prepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-f6-debug-before.txt
grep -q ARHILAB_F6_PREPARE_PASS output/android-f6-debug-before.txt
adb shell am force-stop ru.arhilab.estimate
adb install -r output/Arhilab-Смета-0.8.0-alpha4-debug.apk | tee output/android-f6-debug-install.txt
grep -q Success output/android-f6-debug-install.txt
adb shell am instrument -w -e mode f6Verify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-f6-debug-after.txt
grep -q ARHILAB_F6_F7_UPGRADE_PASS output/android-f6-debug-after.txt
for restart in 1 2; do
  adb shell am force-stop ru.arhilab.estimate
  adb shell am instrument -w -e mode f6Restart ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee "output/android-f6-debug-restart-$restart.txt"
  grep -q ARHILAB_F6_F7_RESTART_PASS "output/android-f6-debug-restart-$restart.txt"
done
if [[ -f output/upgrade-baseline-0.6.2-release.apk ]]; then
  # New isolated signing track. Its 0.6.2 -> 0.7.0 transition never uninstalls the baseline.
  adb uninstall ru.arhilab.estimate
  adb uninstall ru.arhilab.estimate.smoke
  adb install output/upgrade-baseline-0.6.2-release.apk
  adb install arhilab/build/smoke/release-smoke.apk
  adb shell am instrument -w -e mode upgradePrepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-release-upgrade-prepare.txt
  grep -q ARHILAB_UPGRADE_PREPARE_PASS output/android-release-upgrade-prepare.txt
  adb shell am force-stop ru.arhilab.estimate
  adb install -r output/Arhilab-Смета-0.8.0-alpha4-release.apk | tee output/android-release-upgrade-install.txt
  grep -q Success output/android-release-upgrade-install.txt
  adb shell am instrument -w -e mode upgradeVerify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-release-upgrade-verify.txt
  grep -q ARHILAB_UPGRADE_PASS output/android-release-upgrade-verify.txt
  adb shell am force-stop ru.arhilab.estimate
  adb shell am instrument -w -e mode upgradeRestart ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-release-upgrade-restart.txt
  grep -q ARHILAB_UPGRADE_RESTART_PASS output/android-release-upgrade-restart.txt
  adb uninstall ru.arhilab.estimate
  adb install output/upgrade-baseline-f6-release.apk
  adb shell am instrument -w -e mode f6Prepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-f6-release-before.txt
  grep -q ARHILAB_F6_PREPARE_PASS output/android-f6-release-before.txt
  adb shell am force-stop ru.arhilab.estimate
  adb install -r output/Arhilab-Смета-0.8.0-alpha4-release.apk | tee output/android-f6-release-install.txt
  grep -q Success output/android-f6-release-install.txt
  adb shell am instrument -w -e mode f6Verify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-f6-release-after.txt
  grep -q ARHILAB_F6_F7_UPGRADE_PASS output/android-f6-release-after.txt
  adb shell am force-stop ru.arhilab.estimate
  adb shell am instrument -w -e mode f6Restart ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-f6-release-restart.txt
  grep -q ARHILAB_F6_F7_RESTART_PASS output/android-f6-release-restart.txt
fi

# Stable 0.7.0 -> 0.8.0-alpha3 signed in-place upgrade, preserving F1-F6 records.
adb uninstall ru.arhilab.estimate.smoke || true
adb uninstall ru.arhilab.estimate || true
adb install output/upgrade-baseline-0.7.0-debug.apk
adb install arhilab/build/smoke/smoke.apk
adb shell am instrument -w -e mode f6Prepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-070-before.txt
grep -q ARHILAB_F6_PREPARE_PASS output/android-070-before.txt
adb shell am force-stop ru.arhilab.estimate
adb install -r output/Arhilab-Смета-0.8.0-alpha4-debug.apk | tee output/android-080-upgrade-install.txt
grep -q Success output/android-080-upgrade-install.txt
adb shell am instrument -w -e mode f6Verify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-080-upgrade-after.txt
grep -q ARHILAB_F6_F7_UPGRADE_PASS output/android-080-upgrade-after.txt
adb shell am force-stop ru.arhilab.estimate
adb shell am instrument -w -e mode f6Restart ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-080-upgrade-restart.txt
grep -q ARHILAB_F6_F7_RESTART_PASS output/android-080-upgrade-restart.txt
adb shell am instrument -w -e mode screenshots ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-ui08-screenshots.txt
grep -q ARHILAB_UI08_SCREENSHOTS_PASS output/android-ui08-screenshots.txt
for screen in today projects object estimates estimate materials stages payments documents photos settings archive empty; do
  adb exec-out run-as ru.arhilab.estimate cat "files/ui08-$screen.png" > "output/ui08-$screen.png"
  test -s "output/ui08-$screen.png"
done
test "$(find output -maxdepth 1 -name 'ui08-*.png' | wc -l)" -ge 14
adb shell am instrument -w -e mode uiPerformance ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-a3-webview-performance.txt
grep -q ARHILAB_A3_PERFORMANCE_PASS output/android-a3-webview-performance.txt
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 2
adb shell am instrument -w -e mode landscapeCheck ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-a3-landscape.txt
grep -q ARHILAB_A3_LANDSCAPE_PASS output/android-a3-landscape.txt
adb exec-out run-as ru.arhilab.estimate cat files/ui08-landscape.png > output/ui08-landscape.png
adb shell settings put system user_rotation 0
if [[ -f output/upgrade-baseline-0.7.0-release.apk ]]; then
  adb uninstall ru.arhilab.estimate.smoke || true
  adb uninstall ru.arhilab.estimate || true
  adb install output/upgrade-baseline-0.7.0-release.apk
  adb install arhilab/build/smoke/release-smoke.apk
  adb shell am instrument -w -e mode f6Prepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-070-release-before.txt
  grep -q ARHILAB_F6_PREPARE_PASS output/android-070-release-before.txt
  adb shell am force-stop ru.arhilab.estimate
  adb install -r output/Arhilab-Смета-0.8.0-alpha4-release.apk | tee output/android-080-release-install.txt
  grep -q Success output/android-080-release-install.txt
  adb shell am instrument -w -e mode f6Verify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-080-release-after.txt
  grep -q ARHILAB_F6_F7_UPGRADE_PASS output/android-080-release-after.txt
fi

# Alpha2 -> alpha3 signed update without uninstalling, retaining archived and tombstoned estimates.
adb uninstall ru.arhilab.estimate.smoke || true
adb uninstall ru.arhilab.estimate || true
adb install output/upgrade-baseline-alpha2-debug.apk
adb install arhilab/build/smoke/smoke.apk
adb shell am instrument -w -e mode alpha2Prepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-a3-alpha2-before.txt
grep -q ARHILAB_UPGRADE_PREPARE_PASS output/android-a3-alpha2-before.txt
adb shell am force-stop ru.arhilab.estimate
adb install -r output/Arhilab-Смета-0.8.0-alpha4-debug.apk | tee output/android-a3-alpha2-install.txt
grep -q Success output/android-a3-alpha2-install.txt
adb shell am instrument -w -e mode upgradeVerify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-a3-alpha2-after.txt
grep -q ARHILAB_UPGRADE_PASS output/android-a3-alpha2-after.txt
if [[ -f output/upgrade-baseline-alpha2-release.apk ]]; then
  adb uninstall ru.arhilab.estimate.smoke || true
  adb uninstall ru.arhilab.estimate || true
  adb install output/upgrade-baseline-alpha2-release.apk
  adb install arhilab/build/smoke/release-smoke.apk
  adb shell am instrument -w -e mode alpha2Prepare ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-a3-alpha2-release-before.txt
  grep -q ARHILAB_UPGRADE_PREPARE_PASS output/android-a3-alpha2-release-before.txt
  adb shell am force-stop ru.arhilab.estimate
  adb install -r output/Arhilab-Смета-0.8.0-alpha4-release.apk | tee output/android-a3-alpha2-release-install.txt
  grep -q Success output/android-a3-alpha2-release-install.txt
  adb shell am instrument -w -e mode upgradeVerify ru.arhilab.estimate.smoke/ru.arhilab.estimate.Smoke | tee output/android-a3-alpha2-release-after.txt
  grep -q ARHILAB_UPGRADE_PASS output/android-a3-alpha2-release-after.txt
fi
