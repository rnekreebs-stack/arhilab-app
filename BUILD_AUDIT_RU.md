# Arhilab SM 0.6.0 — аудит и подготовка Android-сборки

Дата: 24.09.2026. Итог: CI подготовлен, но не опубликован и не запущен из-за отказа GitHub в записи. Новый APK не получен. Полную Android-работоспособность не заявляем.

## Проверенный источник

Архив: Arhilab-SM-0.6.0-source-private.zip.
SHA-256: 35d375e6971ea21e1f8c6685b88dd888806e7e740bd723c63e693c68b38cbddd.
Java-код приложения, WebView assets, каталог, ресурсы и основной AndroidManifest.xml в подготовленном проекте побайтово совпадают с этим архивом. Новые пользовательские функции не добавлены.

## Технический аудит

| Параметр | Результат |
|---|---|
| Framework | Native Android Activity на Java + WebView с HTML/JS |
| Система сборки архива | Bash: javac → D8 → AAPT2 → zipalign → apksigner |
| build.gradle / settings.gradle | В архиве отсутствуют, Gradle не требуется |
| compile SDK | Android 35 через android-35/android.jar |
| targetSdk / minSdk | 35 / 26 (Android 8+) |
| Build Tools | 35.0.0 |
| JDK для CI | Temurin 17, javac source/target 8 |
| Java в текущей среде | Runtime OpenJDK 17.0.20 есть, javac отсутствует |
| applicationId / package | ru.arhilab.estimate |
| Версия | versionName 0.6.0, versionCode 7 |
| Название | Arhilab SM |
| Иконка | @drawable/icon, PNG 160×180, файл присутствует |
| Android-зависимости | API Android, org.json; внешних Java/Android библиотек нет |
| Тестовые зависимости CI | Playwright 1.51.1, Chromium, Node 22; для Java тестов JDK 17 |
| Абсолютные пути разработчика | Исправлен путь скриншота ошибки в tests/ui.cjs; в исполняемых файлах проекта путей /workspace, /Users, /home больше нет |
| Данные | 254 SKU, 371 работа: 110 с автокомплектами и 261 с ручным подбором |

### Обнаруженное расхождение с GitHub

Репозиторий https://github.com/rnekreebs-stack/arhilab-app доступен для чтения. В нём находится ранняя заготовка Compose/Kotlin: applicationId com.arhilab.app, versionName 1.0, versionCode 1, minSdk 24. Корневой Gradle использует AGP 8.5.2 / Kotlin 2.0.0; существующий workflow запускает именно эту заготовку.

Подготовленный workflow должен заменить `.github/workflows/build.yml` и собирать `arhilab/` из архива 0.6.0. Старый каталог `app/` в удалённом репозитории не изменялся. Использовать его APK как Arhilab SM 0.6.0 нельзя.

## Выполненные изменения сборки

1. Добавлен явный режим Debug / Release в build.sh; вариант по умолчанию Debug.
2. Выделены отдельные каталоги build/debug и build/release с очисткой перед компиляцией, чтобы старые class/dex не попадали в новый APK.
3. Добавлена проверка наличия JDK и Android SDK с понятными ошибками.
4. Добавлена генерация тестового debug-сертификата; Release использует существующий сертификат владельца через переменные окружения.
5. Пароли Release передаются apksigner через env, не через параметры с открытым значением.
6. Добавлена проверка подписи, package, версии, размера APK, каталога внутри APK и SHA-256 файла.
7. Добавлены .gitignore, workflow и общий запуск существующих тестов.
8. Исправлен единственный абсолютный путь разработчика в тесте UI.
9. Добавлен отдельный instrumentation APK для smoke-test на реальном Android WebView и Native bridge; основной APK для этого не менялся.

## Подпись и секреты

Исходный release.p12 успешно открыт локально; alias arhilab существует как PrivateKeyEntry. Сертификат SHA-256:
21bda2218d2b3c9ffece2379ee03c779227c66d729f5e87afffde05887c75410.

Ключ не менялся. В публикуемый комплект ключ и signing-password.txt не включены. Для GitHub предусмотрены Secrets ARHILAB_KEYSTORE_BASE64, ARHILAB_KEYSTORE_PASSWORD, ARHILAB_KEY_ALIAS и при необходимости ARHILAB_KEY_PASSWORD. Инструкция есть в README.md. Автоматическая передача Secrets не выполнялась: доступный GitHub-инструмент не предоставляет операции записи Secrets.

Debug APK с тем же package ID, но тестовым сертификатом не устанавливается поверх прежнего Release. Для обновления без удаления приложения нужна Release-сборка с прежним ключом. Проверять Debug следует на отдельном устройстве/эмуляторе.

## Workflow

- workflow_dispatch и push в main/master;
- фиксированный Ubuntu 22.04;
- JDK 17, Node 22, Android SDK / Build Tools 35;
- установка Playwright и Chromium;
- запуск всех существующих Java/Node/Playwright тестов;
- сборка Debug;
- условная Release-сборка при наличии корректных Secrets;
- Android 35 emulator smoke-test;
- APK Artifact создаётся только после успешного шага сборки Debug;
- отчёты и сведения о commit/run сохраняются отдельно, включая ошибочные запуски.

Smoke-сценарий подготовлен: первый экран → создание администратора через форму → проверка 254 SKU → старая смета без полей класса → новый объект/смета → работа с комплектом → Стандарт/Эконом/Премиум → изменение материалов и сумм → повторный вход → сохранение после перезапуска Activity и полного останова процесса. Старый формат проверяется тестовой записью, а не копией базы конкретного телефона.

## Фактически выполненные проверки

| Проверка | Статус |
|---|---|
| Побайтовое совпадение кода приложения и assets с архивом | PASS |
| Отсутствие закрытых ключей в комплекте для публикации | PASS |
| Доступность оригинального ключа/alias/сертификата | PASS |
| Синтаксис четырёх shell-скриптов | PASS |
| Разбор workflow YAML | PASS |
| tests/calculations.cjs: 20 расчётных сценариев | PASS |
| tests/tier_scenarios.cjs: 20 смет × 3 класса | PASS |
| server/test.mjs | PASS |
| Компиляция Java и Android | НЕ ВЫПОЛНЕНА: нет javac / SDK |
| Playwright UI на текущем этапе | НЕ ВЫПОЛНЕН: нет Chromium |
| GitHub Actions run | НЕ СОЗДАН: запись в GitHub запрещена интеграции |
| APK существует и устанавливается | НЕ ПОДТВЕРЖДЕНО: нового APK нет |
| Android emulator smoke-test | НЕ ЗАПУЩЕН |
| Обновление существующей установки Release | НЕ ПРОВЕРЕНО |

## Точный технический блокер

GitHub API чтение работает. Запись отклонена двумя независимыми поддерживаемыми операциями:

- POST /repos/rnekreebs-stack/arhilab-app/git/blobs — 403 Resource not accessible by integration;
- PUT /repos/rnekreebs-stack/arhilab-app/contents/.gitignore — 403 Resource not accessible by integration.

Через доступный Git endpoint операция ls-remote также не смогла авторизоваться: `could not read Username ... No such device or address`.

Локальная команда сборки завершилась с кодом 2: `JDK compiler javac is missing`. Android SDK и adb/emulator отсутствуют. Попытка доступа к официальному dl.google.com через сеть текущей среды завершилась `Proxy CONNECT aborted due to timeout`. Обход сетевых ограничений не выполнялся.

Это отказ прав интеграции GitHub и ограничение среды, а не отказ сборки из-за Java-кода. Build log успешного/неуспешного workflow отсутствует, поскольку workflow не удалось опубликовать и запустить.

## Что требуется для продолжения

Переподключить GitHub с доступом на запись в rnekreebs-stack/arhilab-app, включая изменения workflow; для получения результатов нужен доступ к Actions. После восстановления доступа можно опубликовать подготовленные файлы, запустить workflow, исправлять ошибки по его логам и скачать APK. Для подписанного Release дополнительно задать перечисленные Secrets через GitHub Settings.

Альтернатива — загрузить этот подготовленный комплект в репозиторий с компьютера владельца и запустить Actions вручную. Закрытые ключи туда не копировать.

Номер успешного run: отсутствует. Новый commit hash: отсутствует. Проверенный текущий HEAD удалённого репозитория: e03ab4f65d9292bdbce5dbe87cd3743e8ef685c4; это старый commit, не результат этой работы. Тип полученного APK: ни Debug, ни Release пока не собраны.
