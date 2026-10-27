# 2026-10-27 SO list Convert to GD: waiting deliveries keep being started after the 2-minute follow

**Status:**
- **Dev:** LIVE on SO list v538 (1901872125787099137), handler-only; the rest of the page is identical to v537.
- **Prod: LIVE in v268 (13:13:48), verified.** `func_handleConvertGD` equals `func_handleConvertGD.js`.
  - The rest of the page equals v267, except that the designer dropped one EMPTY `onFormChange` entry (type rule, no
    code, no rules; someone's v265 edit). That has no effect.
  - Every other event script, every column and the rest of the config are identical.

**Paste (handler only):** open the SO list page in the prod designer and replace the event script `func_handleConvertGD`
with `func_handleConvertGD.js` from this folder. Change nothing else on the page.
- Prod is at v267: other people's designer column changes since v264. Those stay.
- Prod v267's handler equals `func_handleConvertGD.prod_base.js` (checked 10-27 13:12). That is also the rollback.
- After the paste I compare the enabled page's handler with `func_handleConvertGD.js`.

## Why (Kenhin 528521, 10-27 11:58)
- **The batch:** a bulk convert of 13 SOs that share stock became 13 GD Created V2 jobs.
- **What the list did:** it starts each job once, follows them for 2 minutes and re-starts them every 15 s meanwhile.
- **Why it wasn't enough:** jobs that share stock go one at a time, about 30 s each, and each wait pushes the next retry
  ~30 s out. So the batch needed ~6 minutes.
- **The result:** after the 2 minutes 12 jobs were left. Nothing started them again until someone opened the GD list, so
  GD/20261027/2139-2155 sat in Processing for 40+ minutes. Nothing was lost.

## The change (`Goods Delivery/GDhandleConvertSOtoGD.js`)
- **The background step:** after the 2-minute follow, the jobs still waiting are started again every 15 s, with no loading
  screen and no list refresh, in the background.
- **When it stops:** when every job has ended (created, failed, review or confirmation), after 30 minutes, or when the
  page leaves the SO list.
- **Unchanged:** the summary still opens at 2 minutes. It now adds "Keep this list open until then."
- **Untouched:** the refused-lines detail and the customer heading.

## Tests
- **Offline:** 68's suites on the edited handler all pass: `scratchpad/soautogd/shortfall/test_shortfall_client.js` (14),
  `scratchpad/soautogd/test_client.js` (10) and `scratchpad/gdc/gdcreate/test/test_convert_handler.js` (5). They keep their
  exact timer lines.
- **New:** `scratchpad/gdc/gdcreate/test/test_convert_keep_following.js` passes 5/5, 5 runs in a row. The old handler
  fails it. It covers jobs started again until each ends, an ended job not started again, leaving the list, the 30-min
  limit, and no page location.
- **Live on dev, as the Kenhin case** (`scratchpad/gdc/deploy_so_follow/live_keep_following.mjs`, the real handler against
  dev, follow shortened to 20 s):
  - 4 SOs sharing P-00001 + P-00002 at plant …202, tenant 000000.
  - 1 GD was created inside the follow; the summary listed 3 "in the background".
  - The background step finished those 3 one after another at 48, 94 and 125 s, then stopped.
  - GD/20261027/635-638 are all Created.

**After the paste:** the enabled prod SO list's `func_handleConvertGD` must equal `func_handleConvertGD.js` (the GD session
checks it).
