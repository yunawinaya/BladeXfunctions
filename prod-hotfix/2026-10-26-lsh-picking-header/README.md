# Picking V2: header stays In Progress after two confirms at once (2026-10-26)

> **Superseded for the paste (19:40):** `../2026-10-26-packing-unhide/PICKING_BULK_COMMIT.json` carries this change plus the
> Packing un-hide. If this folder's file has not been pasted yet, paste only that one.

**Paste into: PICKING_BULK_COMMIT (id 2109531367339180034).** It is not PACKING_BULK_COMMIT (a look-alike name) and not
PICKING_BULK_PREPARE.

| File | What it is |
|---|---|
| `PICKING_BULK_COMMIT.json` | Paste this. Prod v14 plus the change. Dev runs it as v15 (2026-10-26 17:37), identical |
| `PICKING_BULK_COMMIT.v14.json` | Prod's live v14 (enabled 2026-10-26 06:54), identical to dev v14 and the repo before the change |
| `patch_commit_hdr.py` | Builds the paste file from v14 by inserting the new block, every step asserted |
| `fix_pi_2610_3697.sql` | The one-off data fix for LSH PI-2610-3697 (run 10-26; the header reads Completed since) |

## What went wrong (LSH PI-2610-3697, 10-26 10:02)

- **Two pickers, one Picking.** They confirmed different rows of the same Picking 14 ms apart: job 2114538217914109954
  (2 rows) and job 2114538217968635905 (3 rows). SUBMIT's "another confirm is open" check cannot see a submit that lands
  within milliseconds of another.
- **Both wrote In Progress.** Each job's P1 (`code_node_PCp1merge`) rolled the header up from the Picking as stored when it
  read it, where the other job's rows were still open.
- **The rows and records were fine:** all 5 rows Completed, 5 records, 36 picked of 36.
- **The header stayed In Progress for good.**
  - A new confirm is refused: "enter a picked quantity on at least one line".
  - The P5 gate fills the Packing only when the Picking is Completed. GD-2610-1607's other 7 Pickings filled its Packing; a
    delivery with a single Picking would have been left with an unfilled Packing.
- Since 10-20 this is the only such Picking across all tenants.

## The change (one new block, nothing else changed)

At the top level, after `if_PCp4` and before `if_PCp5`, gated `phase == 'B'` like P6:

- `sql_node_PCbhdr` reads the stored `to_status` and counts the Picking's rows:
  - live rows (`line_status` not Cancelled; a blank status counts as live);
  - Completed rows.
- `code_node_PCbhdr` applies P1's own rule: every live row Completed, and at least one live row.
  - It only ever **promotes** to Completed. It never demotes, and it never touches a Completed or Cancelled header.
- `if_PCbhdrgo` → `update_node_PCbhdr` writes `to_status = 'Completed'` through the same rows pattern as P6's unlock.

**Why phase B:** it is a separate run that starts only after the job's phase A has finished. So the last job of a racing
pair to reach phase B sees both P1 writes. Running before P5 also lets P5 fill the Packing.

## Evidence

- **`scratchpad/pk1d/test/test_header_recheck.js` 8/8**, on the built node. Before the change it failed: the node was
  missing. The cases:
  - promote;
  - one row open;
  - already Completed;
  - Cancelled header;
  - all rows cancelled;
  - a Created header;
  - an empty read;
  - a single-object read.
- **`scratchpad/pk1d/test/test_header_race_flow.js`**: SUBMIT → WORKER → PREPARE → COMMIT A → COMMIT B on the 1c sim. The
  other confirm's late "In Progress" lands between the two COMMIT runs.
  - On v14 it fails like LSH: the header stays In Progress and the Packing gets 0 rows.
  - With the change it passes: the header ends Completed and the Packing gets 3 rows.
- **Regression suites:**
  - `scratchpad/pk1c/sim/test_flow.js` and `test_flow_1c.js` all pass.
  - pk1d `test_commit_fc` 9/9 (needed the new read in the sim mocks, `scratchpad/pk1c/sim/db.js`), `test_worker_fc` 8/8,
    `test_p4_sibling` 5/5; pk1c `test_commit_pm` all pass.
- **Lint** is unchanged against v14; the new code node compiles.
- **The new SQL on prod data:**
  - PI-2610-3697 reads Completed 5/5, after the data fix;
  - PI-2610-3689 reads Completed 6/6.

## After the paste

`.dbtools/wf --prod deployed Picking/AsyncV2/PICKING_BULK_COMMIT.json` must say `IDENTICAL` as 'PICKING_BULK_COMMIT'
(id=2109531367339180034). The prod designer may add empty default fields to sql-nodes on save; that is cosmetic.
