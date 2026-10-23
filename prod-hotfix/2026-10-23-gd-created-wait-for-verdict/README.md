# GD Created V2: the form waits for the verdict (2026-10-23)

On tenant 128671, Save as Created closed the form with "submitted" while the background check went on to refuse the delivery. There were 29 refusals on 10-23: 26 for a unit the item does not know, 3 for short stock. The orders looked saved but had no GD.

The form now stays open ("Checking Goods Delivery...") until the check's verdict:

- **Refused:** an alert lists the lines, for example "Line 3 (Instant Noodle…): unit 箱CTN has no conversion to the base unit of the material".
  - It shows the first 10 lines, then "... and N more".
  - Units appear by name instead of id.
  - The Save buttons come back, and the form is not closed.
- **Accepted** (READY_TO_COMMIT or later): the form closes as before. When the GD number is already known, the message is "Goods Delivery X created."
- **No verdict within 90 s:** the form closes as before ("submitted"). While waiting, the form starts the worker again every 15 s.

| # | Prod item | File here | Base on prod |
|---|---|---|---|
| 1 | **GD_SO_CONVERT_CHECK** workflow (2112084100104495105) | `GD_SO_CONVERT_CHECK.json` | v6, identical to dev v6 (checked 10-23) |
| 2 | GD form event script **`gdV2_onClick_save_as_created`** | `gdV2_onClick_save_as_created.js` | v671's handler, identical to dev v1487's (checked 10-23) |

**Change 1:** each asked job also carries `error_details`: the first 10 line errors plus `line_error_count`, always valid JSON. PREPARE keeps up to 500 line errors, and dev holds one refused job at 118 KB. The SO list and GD list read the same answer and ignore the new field.

## Paste, in this order

1. **GD_SO_CONVERT_CHECK:** paste the JSON into the designer and publish.
2. **GD form:** open the event script **`gdV2_onClick_save_as_created`**, replace its whole body with the `.js`, then save and publish the form.
   - Do not paste it into `gde_onClick_save_as_created`. That is the button's entry script; it routes new saves to `gdV2_onClick_save_as_created`, and it was the 10-23 mis-paste.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json"   # IDENTICAL
.dbtools/form status goods_delivery "Goods Delivery/GDfullJSON.json"             # PROD IDENTICAL
.dbtools/form diff goods_delivery                                                # no handler differs
```

## Undo

The `RESTORE_*` files are what prod runs now. Paste them back the same way.

## Source and tests

- **Dev:** GD form v1488 and GD_SO_CONVERT_CHECK v7 (10-23 10:58). The publish smoke got a real refused job's line errors back through the platform, exactly as expected.
- **Convert check:**
  - `scratchpad/gdc/gdcreate/patch_convert_check_details.py`; `build_convert_check.py` carries the same change.
  - Lint shows only the usual CONDITIONAL notes.
  - The new SQL ran read-only on prod against the 29 refused 128671 jobs: the first 10 line errors and the count are identical to the stored ones. A Chinese-text literal comes through unchanged on dev and prod.
- **Form:**
  - `scratchpad/gdc/gdcreate/deploy_follow/` holds `build_form.py`, `publish.json` and the live bases.
  - `scratchpad/gdform_zero/test_save_created.js` runs 25 cases, 10 of them for the follow: refusal, escaping, 500 lines, cut details, unit names, a failed unit read, timeout with re-kicks, created, already created.
  - 6 mutants of the handler are each caught.
- **Not yet done:** the change has not been seen in a browser.
