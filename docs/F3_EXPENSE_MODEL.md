# F3: фактические расходы объекта

## Проверенная исходная модель

| Источник | Существующее хранение | Значение в F3 |
| --- | --- | --- |
| Legacy `payments[kind=expense]` | Массив объекта, плановая `amount`, фактическая `paid`, `planDate/date`; у старых записей валюта отсутствует | Сохранить без конверсии и двойного включения: не доказано, что каждая запись есть фактический расход выбранной сметы. Администратор должен сначала разрешить валюту; отдельный перенос в Expense требует решения о сопоставлении плановых и фактических сумм. |
| `purchases[ref].actual` | Закупки объекта, состояние, стоимость и фотографии чеков, часть данных может быть неполной | Сохранить в исходной зашифрованной базе; не создавать Expense автоматически, иначе одна закупка и ручной расход могут считаться дважды. |
| `lines.cost`, `materials.cost`, `deliveryCost`, `overhead`, `otherCost` | Плановые внутренние сметные значения | Не считать фактическим расходом. Не менять каталог и сохранённые цены. |
| F2 `payments[kind=income]` | Явные поступления заказчика со связью на смету и валютой | Использовать только для `paidTotal`; не записывать как Expense. |

Новый Expense хранится в существующем зашифрованном `data.enc` в `projects[].expenses`. Новая отдельная база и plaintext cache не создаются. Общие расходы объекта имеют `estimateId = null`; при выборе сметы учитываются только расходы, привязанные к ней. Сохранение расхода и записи в общей F1 queue выполняется одним атомарным сохранением `data.enc` через `F1SyncLedger.capture`. Backup сериализует объект вместе с массивом расходов; старые backup без этого поля получают пустой массив при загрузке.

## Поля и отображение

| Android 0.7 local | Sync `expense` | PostgreSQL `expenses` | Проверка |
| --- | --- | --- | --- |
| `id` | entityId | `id` | Стабильный UUID |
| `projectId` (владелец `projects[]`) | `projectId` | `project_id` | Обязателен, та же organization |
| `estimateId` или null | `estimateId` | `estimate_id` | Nullable, смета того же объекта |
| `category` | `category` | `category` | materials/labor/subcontractor/delivery/equipment/other |
| `amount` | decimal string | `amount numeric(18,2)` | > 0, до 2 десятичных |
| `currency` | ISO 4217 code | `currency char(3)` | Указывается явно, без значения по умолчанию |
| `date` | `businessDate` | `business_date date` | Бизнес-дата, не время синхронизации |
| `description`, `note` | Одноимённые поля | `description`, `note` | Ограниченная длина |
| `createdAt`, `updatedAt` | Local-only | Одноимённые серверные поля | Локальные timestamps живут в encrypted store; сервер назначает собственные даты при записи. Они не входят в бизнес payload |
| `revision`, deletion | F1 revision/operation/delete | `revision`, `deleted_at` | Stage 4 conflict, F1 tombstone |

Backend `expenses` — отдельная от `payments` таблица с tenant-aware FK на объект и составным FK на смету, индексом `(organization_id,project_id,business_date)`. API использует существующие `POST /api/v1/sync/push`, `GET /api/v1/sync/pull`, `GET /api/v1/sync/snapshot`; отдельной sync системы нет.

Admin может создавать, изменять, удалять и получать расходы. Manager и worker не видят `expense` в snapshot/pull, не могут послать expense push и не получают conflict payload. Это соответствует текущей политике платежей F2. Audit create/update/delete и разрешения конфликтов — серверный; raw суммы/описания в audit metadata и production logs не добавляются.

## Расчёт и границы

Для одной явно валютной сметы: `remaining = max(estimateTotal - paid, 0)`, `overpayment = max(paid - estimateTotal, 0)`; `actualExpenses = Σ expense.amount` только для привязанных записей той же валюты; `cashResult = paid - actualExpenses`; `forecastGrossProfit = estimateTotal - actualExpenses`; `forecastMargin = forecastGrossProfit / estimateTotal × 100` при положительном estimateTotal. Это текущая оценка: будущих расходов она не знает. Для других валют считаются отдельные суммы; смешанный результат не выдаётся. Общие расходы без estimateId не попадают в результат сметы.

Экран объекта отдельно группирует `Σ поступлений`, `Σ всех фактических расходов` и их разность по каждой явно указанной валюте. Для старого платежа без валюты показывается предупреждение; он не получает валюту автоматически и не входит в общую сумму до разрешения. Журнал расходов фильтруется по категории, конкретной смете и отсутствию привязки, а при равных датах сортируется по UUID. Экономика выбранной сметы показывает стоимость, оплату, остаток/переплату, фактические расходы, денежный результат и явно прогнозные прибыль и маржу.

Будущие задачи: связывание чеков и поставщиков, plan/fact, правила переноса старых расходных платежей и закупок, права manager для финансов, обработка нескольких валют с явными курсами. OCR, снабжение и F4 сюда не входят.
