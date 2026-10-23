# GD Created V2: check the credit limit at the click (2026-10-23)

## Why

GD Created V2 checked the credit limit only in the background (GD_BULK_PREPARE), after the form had closed with "submitted".

- **Block:** the save failed with `GD_CREDIT_LIMIT_BLOCKED` and nothing told the user. The GD just never appeared.
- **Override:** it passed without asking anyone.

Classic Created, and GD Completed V2, ask at the click instead.

Only organisations with `picking_setup.full_cl_check = 1` are affected. On prod that is one: tenant 900938, org 1962729695608500226. Its 4 V2 Created saves since the cut all passed the check for real, so there was no customer impact.

## What changes

| # | Prod object | File here | Base on prod |
|---|---|---|---|
| 1 | Workflow **GD_ASYNC_SUBMIT** (2105133540498116609) | `GD_ASYNC_SUBMIT.json` | v12, identical to `GD_ASYNC_SUBMIT.prod_v12.json` (checked 10-23 09:53) |
| 2 | GD form, handler **gdV2_onClick_save_as_created** | `gdV2_onClick_save_as_created.js` | v1486, identical to dev v1486 |

1. **GD_ASYNC_SUBMIT:** takes an optional input, `needCL`. Only the GD form sends it.
   - With `needCL = "required"`, a new save runs CREDIT_LIMIT_CHECK before any job is made, under PREPARE's own rule: `full_cl_check = 1`, not No Accounting, a customer, and the total of the top-level lines.
   - It answers `GD_CREDIT_LIMIT_BLOCKED` or `GD_CREDIT_LIMIT_OVERRIDE`, and writes nothing.
   - Callers that don't send `needCL` (SO_AUTO_GD, mobile) behave exactly as before.
2. **Form handler:**
   - The first submit sends `needCL: "required"`.
   - **Block:** an alert with the message, and nothing is saved.
   - **Override:** the Proceed/Cancel prompt classic uses. Proceed resubmits with `needCL: "not required"`, and the delivery is created.

GD_BULK_PREPARE is **not** changed: its background check stays as the safety net. It doesn't conflict with today's other prod fix (`../2026-10-23-gd-v2-picking-not-created/`, GD_BULK_PREPARE only), and the two can be pasted in either order.

## Paste

1. **GD_ASYNC_SUBMIT:** paste `GD_ASYNC_SUBMIT.json` into the designer and publish.
2. **GD form:** open the form's event script `gdV2_onClick_save_as_created`, replace its whole body with `gdV2_onClick_save_as_created.js`, and publish.

Either order works: an older form doesn't send `needCL`, and an older SUBMIT ignores it.

## Correction (prod v670, 09:58)

The new code landed in **`gde_onClick_save_as_created`**, GD Edit V2's entry handler, which is the one the Save as Created button calls. `gdV2_onClick_save_as_created` kept the old code. As a result, edits went to the classic save instead of GD Edit V2.

To fix it in one publish:

1. Event script `gde_onClick_save_as_created`: replace the whole body with `RESTORE_gde_onClick_save_as_created.js`. That is prod v1486's own handler, identical to dev's.
2. Event script `gdV2_onClick_save_as_created`: replace the whole body with `gdV2_onClick_save_as_created.js`.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json"              # IDENTICAL
.dbtools/form sync goods_delivery gdV2_onClick_save_as_created -o "Goods Delivery/AsyncV2/gdV2_onClick_save_as_created.js"   # PROD IN SYNC
```

## Dev (done 10-23 09:51, the user's yes)

- **Published:** GD_ASYNC_SUBMIT v13 (backup v12) and GD form v1487 (backup v1486). The repo is identical to dev.
- **Offline tests:**
  - `scratchpad/gdc/gdcreate/test/test_submit_credit.js`: 11 cases;
  - the existing fit (13) and same-SO (6) tests;
  - `scratchpad/gdform_zero/test_save_created.js`: 15 cases.
- **Live on tenant 000000:** a Block rule answered `GD_CREDIT_LIMIT_BLOCKED` and an Override rule answered `GD_CREDIT_LIMIT_OVERRIDE`, both with no job. The temporary setup was restored at 09:52:29.
