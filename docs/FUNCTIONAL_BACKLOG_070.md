# Functional backlog after F1 audit

| Area | Open decision / next increment |
| --- | --- |
| Objects | Map address, client, status and assignment losslessly to the server; preserve legacy object data. |
| Estimates | Versioned conversion of one embedded legacy estimate to multiple independent estimates, server projection of all lines, delivery, discount and totals; atomic encrypted local sync queue. |
| Catalog | Distribute/reconcile updated catalog with stable SKU/work keys and three tiers; keep the built-in 254 SKU and 371 works. |
| Finance | Decide currency and treatment of legacy delivery/discount in independent estimates; only show cost-based profit with complete actual inputs. |
| Payments | Determine payment-to-estimate relationship; existing 0.6.2 payments belong to a project and lack currency. |
| Tasks | Map progress, due dates and notes to the simpler backend task projection. |
| Employees | Reconcile device-local user credentials/assignments with tenant Stage 2 identities. |
| Photos | Transfer legacy PhotoStore media gradually using Stage 5, preserving offline copies. |
| Documents | Decide supported document sources; no invented binary migration. |
| Sync UX | Add Android encrypted queue, conflict indicator and auth flow without replacing local login or legacy vault. |
| Reports | Keep existing printable offer; decide export formats after estimate mapping. |
| Export | Versioned ARHILAB3 round-trip tests for future multiple-estimate model. |
| Settings | Server account and role mapping with safe offline fallback. |

**BLOCKED BUSINESS DECISION:** Whether delivery and discount stay per object or move to each newly independent estimate affects contract totals and must be decided before multi-estimate migration. F1 can add a default-zero work markup to the current single embedded estimate without making this choice.
