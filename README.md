# Arhilab SM 0.6.0

Актуальный проект находится в `arhilab/`: Java Activity + Android WebView, локальная зашифрованная база. Источник — архив Arhilab-SM-0.6.0-source-private.zip. Каталог: 254 SKU, 371 работа, 110 работ со связанными комплектами и 261 с ручным подбором.

## Сборка

GitHub Actions → Arhilab SM 0.6.0 Android → Run workflow. Workflow также запускается при push в main/master. JDK 17, Android platform/build-tools 35, minSdk 26. Gradle не используется: сборка идёт через javac, d8, aapt2, zipalign и apksigner. Старый каталог `app/` и файлы Gradle в корне относятся к ранней заготовке; workflow их не собирает.

Команды: `bash arhilab/build.sh debug` и `bash arhilab/build.sh release`. Результаты — `output/`. Debug APK имеет пакет `ru.arhilab.estimate`, версию 0.6.0, versionCode 7. У него тестовый сертификат: поверх прежнего Release APK он не обновится. Для проверки используйте эмулятор/отдельное устройство; не удаляйте рабочее приложение с данными.

## Release Secrets

Settings → Secrets and variables → Actions → New repository secret:

- `ARHILAB_KEYSTORE_BASE64`: base64 содержимого **существующего** `release.p12` из приватного архива.
- `ARHILAB_KEYSTORE_PASSWORD`: пароль существующего хранилища.
- `ARHILAB_KEY_ALIAS`: `arhilab` (по умолчанию).
- `ARHILAB_KEY_PASSWORD`: если отличается от пароля хранилища; иначе можно не задавать.

Не вставляйте ключи/пароли в файлы репозитория, workflow, issue или логи. Ключ декодируется только во временный файл runner и удаляется по завершении шага. GitHub Artifact содержит только APK, общедоступные данные сертификата и отчёты. Ожидаемый SHA-256 сертификата прежнего приложения: `21bda2218d2b3c9ffece2379ee03c779227c66d729f5e87afffde05887c75410`. Release с другим сертификатом отклоняется. Ключ не заменяется. Если Secrets отсутствуют полностью, выпускается только Debug; частичная/неверная конфигурация вызывает ошибку.

## Проверки

Существующие Java, Node и Playwright тесты запускаются в CI. Затем APK устанавливается на Android 35 эмулятор. Отдельный instrumentation APK проверяет настоящее приложение и Native bridge: создание администратора, локальную БД, 254 SKU, старую смету без поля класса, новую смету, Standard → Economy → Premium, суммы и сохранение после повторного запуска Activity. В конце выполняются force-stop и холодный запуск, проверка процесса и отсутствия Java-crash. Это не проверка миграции с конкретного телефона владельца и не подключение к реальному серверу.
