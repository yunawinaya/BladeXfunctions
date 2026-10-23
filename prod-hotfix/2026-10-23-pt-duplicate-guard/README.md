# Plant Transfer duplicate guard (SM_PLANT_TRANSFER, 2026-10-23)

Why: prod 10-23, tenant 128671. A 63-line mobile Issue (PT/202610230030) took 116 s. The phone lost the 200 and resent
the same transfer 4 times. Every resend was a brand-new create; only a stock shortage on 2 of the 63 lines stopped a
duplicate. The lost reply also skipped the app's automatic In Progress, so the PT stuck at Issued with no receiving
document.

## What changed (`SM_PLANT_TRANSFER.json`, built on v104; dev v104 == prod v104, md5 f2f93cf62ea0e05a3fe12ca9fe879a13)

All additive, 57 new nodes (`*PTdup*`). Builder: `scratchpad/ptguard/build_guard.py`, node bodies `scratchpad/ptguard/code/`.

1. **Duplicate guard for NEW transfers (Draft / Issued).**
   - The app's `allData.pt_idem_key` is honoured only from the app: pageStatus Add, no web `$_v`. Issued saves also get a
     server fingerprint (tenant + user + plants + lines), matched within 15 minutes, which covers old app versions and the web.
   - Stored in the existing hidden form field `pt_uuid` as `key|fingerprint|SAVING|SAVED` (`-` = none). No form change.
   - Before the stock check:
     - an earlier save that is SAVED → **200 replay**, with that transfer's id;
     - still SAVING → **400 `PT_SAVE_IN_PROGRESS`**;
     - SAVING for 30+ min → **400 `PT_SAVE_INCOMPLETE`**.
   - Right after both header inserts, a twin read-back: when two saves overlapped, the older one wins and the newer one
     soft-deletes its own header before any stock moves.
   - The new Issued transfer is stamped SAVED at the very end.
2. **Draft on a stored non-Draft PT refused**: 400 `PT_DRAFT_NOT_ALLOWED`. It used to stamp Draft without reversing In
   Transit, so re-issuing deducted twice.
3. **Per-run cache keys** replace the per-user `generatedBatches_` / `newSubFormData_` / `finalSubFormData_` keys (14
   nodes). Two runs by the same user could mix each other's arrays.
4. **In Progress**: a twin read-back after the receiving child insert. Of two concurrent runs' children, the newer one
   deletes itself.

## Contract (for the app)
- `allData.pt_idem_key`: `^[A-Za-z0-9:_.-]{8,128}$`, one per new-document form session and content. A malformed one
  answers 400 `PT_IDEM_KEY_INVALID`.
- Answer fields: `code`, `message`, `result_code`, `id`, `stock_movement_no`, `stock_movement_status`, `replayed`. All are
  strings; `replayed` is "1" on a replay, otherwise "0".
- Old apps show any 400 as "Failed to save Plant Transfer". They recover on the replay 200, which also runs their
  automatic In Progress.

## Status
- **DEV: v105 LIVE 2026-10-23 11:24** (v104 backup:
  `~/Documents/ASC-dev/workflow-backups/dev/SM_PLANT_TRANSFER/v104_20261023T032447.enabled.json`). The repo
  `Stock Movement/Plant Transfer/PTsaveWorkflowChangeFlow.json` was re-seeded from v105 (IDENTICAL).
- Tests:
  - `node scratchpad/ptguard/test/test_guard.js`: 25/25, run on the shipped node bodies.
  - The 5 real incident payloads give one fingerprint.
  - Live dev run on tenant 000000 (`scratchpad/ptguard/test/live/`): **all passed.**
    - key replay, fingerprint replay;
    - concurrent twins: PT/202610230269 deleted itself, no stock moved;
    - retry while saving → `PT_SAVE_IN_PROGRESS`, then replay;
    - Draft key replay;
    - Draft refusal;
    - concurrent In Progress: child PT/202610230273 deleted itself;
    - full receive, cancels. Every balance is back except the 1 received unit of P-00002.
- **PROD: LIVE 2026-10-23 13:40:42** (pasted by the user; prod numbered it v62, the old v104 is now history).
  `.dbtools/wf --prod deployed` → IDENTICAL. The mobile session was told to switch its re-send on for prod.

## Prod paste (user)
1. Check prod is still v104: `.dbtools/db --prod "SELECT version_number, MD5(script_json) FROM su_code_workflow_history WHERE data_id=2025864403783462913 AND status='enabled' ORDER BY version_number DESC LIMIT 1"` → 104 / f2f93cf62ea0e05a3fe12ca9fe879a13. If not, rebuild on the live version.
2. Paste `SM_PLANT_TRANSFER.json` into SM_PLANT_TRANSFER (2025864403783462913) in the prod designer and enable it.
3. Verify: `.dbtools/wf --prod deployed "Stock Movement/Plant Transfer/PTsaveWorkflowChangeFlow.json"` → IDENTICAL.
4. Rollback: re-enable v104 from the prod history.

## Known limits
- A losing twin uses up one document number. Its lines stay under the soft-deleted header, the same as LOT V2's Draft twin.
- A new Draft still answers with an empty `id` (existing classic quirk in `code_node_ozYIFP2S`); its replay carries the id.
- On orgs with generate_new_batch = 1, batch generation runs before the header insert. A losing twin can leave generated
  batch rows behind.
- PT V2 (async, 2,000 lines) is postponed by the user.
