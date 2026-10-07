# Arhilab Смета

Стабильная версия в `main`: **0.7.0**. Ветка `arhilab-0.8.0-ui-local` содержит предварительную **0.8.0-alpha3** (`versionCode 14`); она не объединена с `main`. Внешний сервер для этого обновления не нужен. См. [заметки об alpha3](RELEASE_0.8.0-alpha3.md) и [первом preview](RELEASE_0.8.0-alpha1.md).

Стабильная версия Android-приложения: **0.7.0** (`versionCode 11`), package `ru.arhilab.estimate`. Исходники: `arhilab/` (Native Android Java + WebView); серверная часть: `backend/` (Node.js 22, TypeScript, PostgreSQL 17). Каталог содержит 254 SKU, 389 работ и 110 автоматических комплектов.

## Возможности

- Несколько смет на объект, наценка на работы, сохранение исторических цен. В alpha2 смету можно архивировать, восстановить и пометить как удалённую без физического удаления истории.
- Локальные платежи, расходы, этапы, задачи, закупки и экран «Сегодня»; классы Эконом / Стандарт / Премиум сохранены.
- Клиентские документы F7: КП, подробная и краткая смета, сохранённые версии и многостраничный PDF.
- Серверный REST API `/api/v1`: организации, сотрудники, роли, устройства, авторизация, операции синхронизации с ревизиями и конфликтами, файлы и документы.
- Все основные действия Android доступны без сети. Производственное подключение Android к новому sync API, первоначальный перенос локальных данных и автоматическая синхронизация между телефонами остаются отдельной работой. Сервер разворачивается отдельно.

Подробнее: [release notes](RELEASE_0.7.0.md), [изменения](CHANGELOG.md), [архитектура Android](docs/ANDROID_070_SYNC_ARCHITECTURE.md), [backend](backend/README.md).

## Обновление с 0.6.2

Release 0.7.0 подписан постоянным сертификатом Release 0.6.2. CI проверил установку через `adb install -r` поверх 0.6.2: старые объекты, сметы, материалы, этапы, платежи и локальная сессия сохранились. Не удаляйте приложение перед обновлением; сначала создайте и проверьте отдельную зашифрованную копию. Debug и Release подписаны разными ключами и не обновляют друг друга.

Debug 0.6.1 из Actions #20 был подписан одноразовым утраченным ключом; обновить ту конкретную установку поверх невозможно. Сначала экспортируйте данные и проверьте копию перед удалением.

## Сборка и подпись

Требуются JDK 17, Android SDK platform 35 / build-tools 35.0.0, Python 3; для Node/Playwright тестов — Node.js 22. Из корня репозитория:

```bash
bash arhilab/tests/run.sh
bash arhilab/build.sh debug
```

Для локальной сборки установите `ANDROID_SDK_ROOT`, `JAVA_HOME`, `SIGNING_KEYSTORE`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS` и, при необходимости, `SIGNING_KEY_PASSWORD`. Release собирается командой `bash arhilab/build.sh release` только с существующим постоянным ключом. Ключи и пароли не помещайте в репозиторий или журналы.

[Android CI](.github/workflows/build.yml) запускает Java/Node/Playwright тесты, собирает Debug и подписанный Release при наличии Secrets, выполняет upgrade/offline/emulator smoke и публикует APK. Постоянный Debug keystore передаётся через `ARHILAB_DEBUG_KEYSTORE_BASE64`; Release — через `ARHILAB_KEYSTORE_BASE64`, `ARHILAB_KEYSTORE_PASSWORD`, `ARHILAB_KEY_ALIAS` и при необходимости `ARHILAB_KEY_PASSWORD`. [Backend CI](.github/workflows/backend.yml) проверяет lint, typecheck, unit/integration, PostgreSQL migrations, Docker и health. Локальный запуск описан в [backend/README.md](backend/README.md).

Старая заготовка `app/` и корневой Gradle не участвуют в сборке Arhilab Смета.
