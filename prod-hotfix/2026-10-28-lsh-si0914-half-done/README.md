# 2026-10-28 LSH SI2610-0914: invoice saved, but its Sales Order status and receivable were never written

**Status:** DONE on prod 10:29:29, verified.
- SO-Tom-036035 is Fully Invoiced.
- Receivable SI2610-0914 (id 2115277371605946368) is Unpaid, total and outstanding 1,404.30, and has 14 lines (sum
  1,404.30), 14 closure rows and 1 link.
- Every stored column equals what `build_repair.py` planned.

## What happened
- **The conversion:** yen converted GD-2610-1847 to an invoice at 10:05:27, right after the prod restarts (10:01 / 10:03).
- **The failure:** SI_SAVE run 2115263648577490946 inserted SI2610-0914, then failed in its fork at `update_node_CTTDlnVN`
  "Update SO" with `sales_order 的 update 条件字段 [issued_status] 不存在或不可持久化`.
- **Why it's a one-off:** that was a short platform glitch after the restart. Every SI_SAVE and ATC_SYNC_SO since 10:07
  writes the same update.
- **Her retry:** at 10:05:39 it was refused, because the GD already has an invoice.

## What was written and what was not (checked on prod)
| Step | State |
|---|---|
| Invoice SI2610-0914 (Credit, 1,404.30, Unposted) | written |
| 14 SO lines and 14 GD lines (invoice_qty / si_status) | written, equal to what the run planned |
| GD-2610-1847 header: si_status Fully Invoiced | written (10:05:29) |
| **SO-Tom-036035 header: si_status Fully Invoiced** | **missing**: still Not Created |
| **Receivable (AR_SAVE add-node: ar_invoice + plant link + lines + closure rows)** | **missing** |
| SI_POST (auto post) | not applicable: LSH has `auto_post_si = 0` |
| Customer payment (CP_SAVE) | not applicable: the invoice is Credit |
| Auto PI | not applicable: the convert asked to skip |
| GD_Convert_SI after "8. Create SI" | cache and summary only, no writes |

## How the SQL was built (`build_repair.py`)
- **The payload:** it replays prod SI_SAVE v49's own "Map AR Data" (`code_node_p0XoMz8H`) on the failed run's recorded
  inputs. It then maps the result through AR_SAVE v19's add-node props.
- **The self-check:** the same replay on reference run 2115265392602648577 (SI2610-0930, eve, 10:12, 14 lines, receivable
  untouched since) equals that run's recorded output. The rows built from it equal the reference receivable's rows column
  for column, in all four tables.
- **System columns:** create / update user = yen (the invoice's creator), dept = the invoice's dept, times = when the SQL
  runs. Ids use worker 1001.
- **Preview:** every VALUES block was previewed read-only on prod. It parses, with 1 / 1 / 14 / 14 rows, and no id clashes.

## Run, in order
1. **PART 1 (checks):** every expected value must match.
2. **PART 2 (the repair):** expect rows affected 1 / 1 / 1 / 14 / 14. Every statement is guarded, so a second run changes
   nothing.
3. **PART 3 (after-checks):** SO-Tom-036035 is Fully Invoiced. Receivable SI2610-0914 is Unpaid with 1,404.30 total and
   outstanding, and has 14 lines, 14 closure rows and 1 link.

**Not touched:** SI_POST and the invoice's posting status. It stays Unposted, as every LSH invoice does until it is posted.
