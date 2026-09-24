#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/tests
javac -encoding UTF-8 -d build/tests src/ru/arhilab/estimate/{MaterialMarkup,BackupCrypto,PhotoStore}.java tests/{MaterialMarkupTest,StorageCryptoTest,AndroidKeystoreIvTest}.java
for test in MaterialMarkupTest StorageCryptoTest AndroidKeystoreIvTest; do java -cp build/tests "$test"; done
for test in tests/*.cjs; do node "$test"; done
node server/test.mjs
