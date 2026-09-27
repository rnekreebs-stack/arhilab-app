# F2 payment model and 0.6.2 audit

## Observed behavior

`MainActivity` stores `payments[]` inside an encrypted project. Its `payment` action creates an `income` or `expense` with a planned `amount`, a separately entered `paid` value, business `date`, optional `planDate`, `note`, and `type`. `paymentUpdate` changes `paid`, `planDate`, and `actualDate`; `remove` deletes the row locally. There is no currency or estimate ID in 0.6.2. `core.js` adds **paid**, not planned amount, for incoming payments; expenses are separate. The old object had one embedded estimate, but expenses may cover the entire project. Admin sees all payment data; manager sees incoming rows only; worker sees none. Existing rows are displayed in insertion order. The backend currently stores project ID, amount, mandatory currency and `paid_at`, without payment kind, paid amount, business date or estimate owner.

## Agreed product decisions

- Old incoming and outgoing records stay attached to the object. Admin may explicitly attach an incoming payment to a selected estimate. Never attach them automatically to the original estimate.
- Each estimate has an explicitly selected currency. Old estimates have **no inferred currency** until admin confirms one. A new payment must explicitly specify its currency. Show `paid/remaining` only for payments attached to the selected estimate with the same currency. Never convert or add unlike currencies.
- The original object payment list and expenses remain available. An object-level payment is not included in the selected estimate's balance. Existing object-level calculations retain their 0.6.2 meaning.

## Field mapping

| 0.6.2 payment | 0.7 local | Backend `payments` | Sync / UI |
| --- | --- | --- | --- |
| `id` | Same UUID | `id` | Stable entity and operation identity; direct. |
| Project container | `projectId` | `project_id` | Direct. |
| Absent estimate owner | Optional `estimateId` | Nullable `estimate_id` | Only explicit admin link. Old rows unassigned. |
| `kind` income/expense | Same | `payment_kind` | Direct. Expenses excluded from estimate `paid`. |
| `amount` planned | Same decimal | `amount` | Direct; never substituted for received amount when `paid` is present. |
| `paid` received | Same decimal | `paid_amount` | Direct; for absent legacy field, old `core.js` uses `amount`. |
| Missing currency | Absent until explicit selection | `currency` mandatory | Block server sync and estimate balance, preserve source row. |
| `date` business day | Same ISO date | `business_date` | Direct; independent of created/synced timestamps. |
| `planDate`, `actualDate` | Same | `plan_date`, `actual_date` | Direct. |
| `note`, `type` | Same | `comment`, `payment_type` | Direct, bounded strings. |
| Array order | Original order locally | No semantic order | Old list keeps order; estimate list sorts business dates newest first. |
| Local deletion | Tombstone in outbox | `deleted_at`, revision | Sync tombstone; admin confirmation in UI. |

`estimate.currency` is nullable for migration, with no default. All monetary fields use NUMERIC(18,2)/decimal strings for wire and half-up to two decimals in the UI. The F2 balance uses *received* income only. Negative adjustments/refunds are out of scope. Project-level planned expense and internal cost are not revenue and do not appear in the estimate balance.

## Privacy

Server operations are admin-only through `assertCurrentAdmin`. Financial payment identifiers and snapshots must not reach manager/worker. Existing Android manager income display remains local under the 0.6.2 security model; server sync must not widen that grant. Profit and private costs remain separate and restricted as in F1.

The organization-wide cursor may advance past a hidden payment change; its numeric gap is not a payment identifier or amount. No payment entity or snapshot is returned to non-admin clients. A future per-role cursor would be required to hide all timing/count side channels.

## Operational behavior

The new `Платежи сметы` tab uses the selected estimate only. It shows `Стоимость сметы`, `Оплачено` and either `Осталось` or `Переплата`. `paidTotal` sums received income (`paid`, not planned `amount`) whose `estimateId` and currency match the selected estimate. Old object-level payments are shown in their old tab; they never enter this balance without a deliberate admin link. New payment amount equals received amount, has positive two-decimal precision and a business date; an edit or confirmed removal is saved inside the same encrypted database commit as its durable F1 outbox entry. F1 push/pull/snapshot/idempotency/conflicts handle payment operations. A missing legacy currency suppresses only that payment projection, leaves the original row in the encrypted project and flags a user-facing resolution message. Resolving the currency and optionally assigning an income payment is an explicit admin action; no bulk assignment occurs.
