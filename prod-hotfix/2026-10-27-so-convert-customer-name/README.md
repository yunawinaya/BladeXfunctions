# SO list Convert to GD: refused sales orders headed by their customer (2026-10-27)

**Ask (user, 10-27):** in the convert result window, replace "not enough stock for N items" with the customer name of that
sales order.

**Change:** a refused sales order shown in detail (its short-stock table, or its refused lines) is now headed
"SO number — customer name", for example "SO/20261026/0104 — Restoran Maju Jaya". It used to say "not enough stock for N
items", or "N lines need correcting" when other refused lines were listed too.

- The name is the one in the list's Customer Name column (`customer_name.customer_com_name`). The selected rows already
  carry it, so there is no extra fetch.
- A row without a name keeps the old heading.
- One-line refusals (credit limit, no answer from the server, held for review) are unchanged: "SO number — reason".
- "… and N more" still shows when a sales order has more than 10 refused lines.

| # | Prod item | File here | Base on prod |
|---|---|---|---|
| 1 | SO list page (1901872125787099137), event script **`func_handleConvertGD`** | `func_handleConvertGD.js` | v263's handler, the same as v262's and dev v536's (checked 10-27) |

Prod v263 (10-27, a designer edit, not this change) added a "Payment Name" column (`so_payment_term.term_name`). This paste
replaces only the handler, so that column stays. Dev does not have the column.

## PROD DEPLOYED 2026-10-27 (user), verified

- SO list page id 1901872125787099137 is enabled **v264**, and its `func_handleConvertGD` is the repo handler.
- v264 = v263 with only that handler changed. The designer also dropped v263's empty `onFormChange` (no body). The Payment
  Name column is still there.
- prod_health showed the 3 CHECKs that were already there, plus one classic SO_SAVE crash (tenant 681409, 10:13). That one
  is a required-field check, "Validation Error: Sales Order Number": the run stopped at its first step before any write, and
  the next save 24 s later completed. Unrelated to this change.

## Paste

Open the event script **`func_handleConvertGD`**, replace its whole body with `func_handleConvertGD.js`, then save and
publish the page. Not `func_bulkConvertGD`: that is the button's entry script.

## Dev

SO list **v537** was published 10-27 with the user's yes.

- v536 was backed up first: `~/Documents/ASC-dev/workflow-backups/dev/SO list/v536_20261027T022710.enabled.json`.
- The read-back is identical to the built page, and its handler is the repo's `Goods Delivery/GDhandleConvertSOtoGD.js`.
- The publish needed `designingHistoryId` again (row 2114906662256586753). See the plan in
  `scratchpad/soautogd/shortfall/deploy/publish_page_customer.json`.
- Not yet seen in a browser. The rows carry the name because the list shows it as a visible column (Customer Name); a
  row without it keeps the old heading.

## Check after pasting

```
python3 scratchpad/soautogd/shortfall/deploy/build_page.py --env prod --old "Goods Delivery/GDhandleConvertSOtoGD.js" \
  --new "Goods Delivery/GDhandleConvertSOtoGD.js" --base-out /tmp/so_list_prod.json
# -> "live handler == Goods Delivery/GDhandleConvertSOtoGD.js"; an AssertionError means the paste did not land there

python3 scratchpad/prod_health.py
```

## Undo

Paste `RESTORE_func_handleConvertGD.js` (prod v262's handler) back the same way.

This works only while this paste is the latest change to the handler. On 10-27 the GD session started changing
`followBackground` in the same handler (re-kicking the worker while following). Once their paste lands, this file would
wipe their change too, so remove only the customer lines instead.

Prod v265 (10:38, a designer edit to the column display) and the v266 being designed at 12:50 still carry this handler.

## Tests

- `scratchpad/soautogd/shortfall/test_shortfall_client.js`: 14 cases pass. Two are new: a row without a name keeps the
  old heading, and the name is HTML-escaped.
- `scratchpad/soautogd/test_client.js` (10) and `scratchpad/gdc/gdcreate/test/test_convert_handler.js` (5) pass.
- `gdc/gdcreate/shelved_so_list_cap/test_convert_follow_cap.js` fails the same way on the old handler: it tests the
  shelved concurrency-cap patch, which is not applied.
