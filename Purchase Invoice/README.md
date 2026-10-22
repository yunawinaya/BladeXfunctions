# Purchase Invoice at 2,000 lines (lean save and conversions, dev 2026-10-21)

The PI path now runs a 2,000-line invoice synchronously. Before this change, one request carried 45–108 MB of node
data, the size that took dev down on 10-09 and 10-16. It now carries 4–11 MB. There is no background job: an invoice
moves no stock and makes no per-line calls, so the only problem was copying whole documents through many nodes. Requests,
responses, end codes (401–410) and messages are unchanged, and so are the callers: the PI form, the GR and PO list
pages, SI_TO_PI and PO_SAVE's direct PI.

| What (dev version) | Change |
|---|---|
| PI_SAVE v20 (`PIsaveWorkflow.json`) | Three things change. (1) v19's doc no → required fields → CHECK_REQUIRED_FIELD → invoice qty → fill-back chain is one node, `code_pi_prep`. Each step is the old code, and the platform's output filter runs between the steps as it did between the old nodes. (2) The PO / GR reads are sql-nodes that read only the line columns the check uses. (3) The over-invoice check (410) and the PO / GR roll-up are one node, `code_pi_check`, which runs before the write. The id and number are read back by sql after the write; v19 re-read the whole invoice |
| GR_Convert_PI v20 (`convertGRtoPIworkflow.json`) | GRs, their lines, PO rates and PO lines come from sql-nodes holding only the fields the mapping reads. The mapping code is unchanged. The loop hands PI_SAVE its own item; v18 re-read the whole list on every pass through a cache counter |
| PO_CONVERT_PI v6 (`convertPOtoPIworkflow.json`) | Same approach. The check passes on the PO ids it lets through, and "3. Get Org ID" is gone |
| PI form v626 (`PIfullJSON.json`) | `PIcalculation` writes only the line values that change, so a price edit on 2,000 lines makes 3 row writes instead of 10,000. It also builds its bundle-children index once. Batch Add reads PO lines 500 at a time (2,003 reads → 7) and batches the per-line UI calls (6,002 → 6) |

Builders: `scratchpad/pi2k/build_pi.py` (workflows, from the live JSON in `base/`) and `scratchpad/pi2k/client/build_form.py`
(form). Code bodies are in `scratchpad/pi2k/code/` and `client/`.

## Tested

| Test | Result |
|---|---|
| Recorded runs replayed through old vs lean (`sim/replay_save.js`, `replay_convert.js`) | PI_SAVE 947/947, GR_Convert_PI 339/339, PO_CONVERT_PI 35/35 (dev + prod, 90 days): same outcome, same writes, same invoice payloads |
| Synthetic paths (`sim/scenarios_save.js`) | 22/22: Add, Convert, Edit, Draft, 406/407/409/410, bundles nested and flat, split GR lines, credits, custom fields left out, manual numbers |
| New sql reads vs the platform's own read (`test/test_sql.py`, `test_sql_cv.py`) | identical on 19 dev documents, including bundle trees and 2,000-line POs |
| PI form handlers (`client/client_test.js`) | the form ends up identical in every case, old vs new |
| Live on dev, small (`test/live_check.py`) | PO/20261021/024 → PI/20261021/0037; bundle GR/202609220021 → PI/20261021/0038. Every stored column matches what v18/v19 would write; a repeat convert answers the same 402 |
| Live on dev, 2,000 lines (`test/live_2k.py`) | 711077 GR/202610150006 → PI/20261021/0001: 108 s, 4.7 + 6.2 MB. PO/20261015/009 → Draft-PI-00010 (17 s, 3.8 + 3.9 MB) → Completed as PI/20261021/0039 (92 s, 4.3 MB). PO/20261016/015 → PI/20261021/0040: 104 s, 3.8 + 5.2 MB. Each time all 2,000 lines are Fully Invoiced |

Time at 2,000 lines on dev (2–7× slower than prod since 10-16): about 90 s. Most of it is the platform writing the PO / GR
line counters, about 46 ms per line; that update node is v19's and was not changed. The invoice insert is about 11 s. The
nodes rewritten in this pass take under 1 s.

## Received GRs are invoiced like Completed ones (user 2026-10-21)

A `Received` GR has finished receiving and is only waiting for putaway. Its line quantities are final, so it is invoiced
like a Completed one.
- **GR_Convert_PI v21** reads `Completed` and `Received` GRs. Up to v20 the status check let Received through but the
  read took only Completed, so "5. Map PI Data" crashed. Prod hit this 18 times in 90 days; dev 2.
- **Nothing left to convert** now ends with a 402: "None of the selected Goods Receivings can be converted. Only
  Completed or Received Goods Receivings can be invoiced." This covers Draft, Created and Cancelled GRs after the user
  chose Proceed. It used to crash, and in "multiple" mode it used to report success with nothing created.
- **Batch Add (PI) page v12:** the "Document - GR" tab lists Received GRs too.
- **Batch Add (PI) page v13:** the "Item - GR" tab lists only lines of Completed and Received GRs. It used to take every
  status except Draft and Created, so lines of Cancelled and Processing GRs were offered. Prod had 1 invoice line from a
  Cancelled GR.
- **Later steps are unaffected.** Putaway completion writes only the GR header (`gr_status`, `putaway_status`) and never
  the line counters. GR revert already refuses a GR that has a live invoice, Draft or not.
- **Replay** of the 339 recorded GR → PI runs: 312 unchanged, the 20 Received cases now invoice, and the 7
  nothing-to-convert cases answer 402.

## Known, not changed

- A minted test token whose first department is deleted (`scratchpad/gdc/tools/id000000.json`) gives an empty
  `{{global:firstLvDeptId}}`, so GR_Convert_PI finds no number rule and PI_SAVE fails with "Next serial number is
  already in use". Use `id000000_asai.json` for 000000 tests.
- PI Cancel and PI Post at 2,000 lines (measured 2026-10-22, not changed). PI_CANCEL v17 projects to ~16 MB in one
  request: it reads the whole invoice, POs and GRs and passes them through one node, with no loops or per-line calls.
  Its time is the same PO / GR counter writes as the save. PI_POST is ~2 MB: all 249 prod posts in 60 days took the
  AutoCount V2 path, which reads the invoice once and hands it to the integration.
