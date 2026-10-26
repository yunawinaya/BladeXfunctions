# 2026-10-26 GD Created V2 keeps its Packing shell hidden ("Waiting") until a Picking fills it (GD_BULK_COMMIT)

**PASTED and verified, 2026-10-26 19:57:15:** GD_BULK_COMMIT (id 2104840402446245890) prod v30 is IDENTICAL to
`GD_BULK_COMMIT.json` (679/679 node ids).
- **Order kept:** steps 1 (desktop list page, enabled 19:52:02) and 2 (PICKING_BULK_COMMIT v15 19:54:13, PICKING v83
  19:55:24) were verified live first.
- **Still out:** the mobile OTA (the user's) and Packing's cleanup (step 4).
- **First live check:** the next packing-required V2 GD. `scratchpad/prod_health.py` section PACKING-HIDDEN flags a
  "Waiting" Packing whose GD is fully picked or that already has lines.

**Paste into: GD_BULK_COMMIT (id 2104840402446245890)**, file `GD_BULK_COMMIT.json`.
- **Prod base:** prod is live v29 (2026-10-26 09:36:26), identical to `GD_BULK_COMMIT.prod_v29_base.json` (also the rollback).
- **Dev:** v32 (19:42:15), identical to the paste file.

## Paste order (do not change)
1. **Packing V2:** the desktop Packing list filter (`../2026-10-26-packing-list-hide-waiting/`) and the mobile Packing list
   (OTA). Both hide "Waiting".
2. **GD Edit & Picking V2:** PICKING_BULK_COMMIT + PICKING. These turn "Waiting" into "Created" when a Picking fills the shell.
3. **This paste.**
4. **Packing V2's cleanup** (`../2026-10-26-empty-packing-shell-cleanup/`). It moves the existing empty Created shells to
   "Waiting".

Steps 2 and 3 must not swap. If they do, a picked delivery's Packing stays hidden.

## What changes
The user decided on 10-26: keep the save-time Packing shell, hidden until picked, with no extra guard in Picking. Without the
shell, Picking would have to create the Packing, and two Pickings of one GD confirming at the same moment happened 95 times
across 29 LSH GDs since 10-25 15:22.
- **P2 is unchanged.** It still writes the shell for packing-required GDs, as "Processing" (the in-commit marker),
  `PKG|<gd_id>`, numbered.
- **P7A** (code_node_SlxWSQ0R) flips it to **"Waiting"** instead of "Created".
- **Checks:** the P7B check (code_node_w5PAtzWc) and the P2 check (code_node_HGbnLhvZ) accept "Waiting". They still accept
  "Created" for a job an older version already flipped.
- **Title only:** the flip node update_node_PV0oFLij is renamed.
- **Nothing else changes.** Clean-failure deletes still act only inside the failing run. GD Cancel V2 cancels a "Waiting"
  shell with its GD. Cancel and revert busy checks look only at live mobile leases, and GD_JOB_RECONCILE never reads Packings.
- **Prod scope:** all 15 prod packing setups have auto_trigger_pkg = 1, so Picking always reaches the shell.

## Tests
- **Offline:** `scratchpad/gdc/gdcreate/test/test_commit_hidden_shell.js` passes all 16 cases on the paste file. The prod v29
  base fails exactly the 3 new-behaviour cases.
- **Lint:** no new findings. Only the 4 nodes above differ from the base.
- **Dev end-to-end, tenant 496474 (10-26 19:50-19:53):**
  1. A V2 GD from SO/20261008/021 gave GD/20261026/124. Its Packing PACK/20261026/0067 stayed "Waiting" and empty.
  2. The Picking confirm of PI-20261026-0114 (GD Edit & Picking V2) turned it "Created", with 2 rows Fully Picked. It is still
     the only Packing of the GD.
  3. The Packing V2 browser completion is Packing's step.
- **Script:** `scratchpad/gdc/gdcreate/patch_commit_hidden_packing_shell.py`.

After the paste: `.dbtools/wf --prod deployed "prod-hotfix/2026-10-26-gd-commit-hidden-packing-shell/GD_BULK_COMMIT.json"`
must say IDENTICAL, deployed as 'GD_BULK_COMMIT' (id=2104840402446245890).
