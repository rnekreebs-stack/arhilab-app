# Functional backlog after F1 audit

| Area | Open decision / next increment |
| --- | --- |
| Objects | Map address, client, status and assignment losslessly to the server; preserve legacy object data. |
| Estimates | Versioned conversion of one embedded legacy estimate to multiple independent estimates, server projection of all lines, delivery, discount and totals; atomic encrypted local sync queue. |
| Catalog | Distribute/reconcile updated catalog with stable SKU/work keys and three tiers; keep the built-in 254 SKU and 371 works. |
| Finance | Legacy delivery/discount belong solely to the original estimate; new estimates begin at zero. Decide whether independent estimates are alternatives or additive before showing one aggregate contract total. Only show cost-based profit with complete actual inputs. |
| Payments | Determine payment-to-estimate relationship; existing 0.6.2 payments belong to a project and lack currency. |
| Tasks | Map progress, due dates and notes to the simpler backend task projection. |
| Employees | Reconcile device-local user credentials/assignments with tenant Stage 2 identities. |
| Photos | Transfer legacy PhotoStore media gradually using Stage 5, preserving offline copies. |
| Documents | Decide supported document sources; no invented binary migration. |
| Sync UX | Add Android encrypted queue, conflict indicator and auth flow without replacing local login or legacy vault. |
| Reports | Keep existing printable offer; decide export formats after estimate mapping. |
| Export | Versioned ARHILAB3 round-trip tests for future multiple-estimate model. |
| Settings | Server account and role mapping with safe offline fallback. |

**Resolved:** Legacy delivery and discount belong to the original estimate. New estimates do not inherit them. **Open:** Whether multiple estimates are alternative options or additive changes determines any future object-wide total; no aggregate is shown until that decision.
