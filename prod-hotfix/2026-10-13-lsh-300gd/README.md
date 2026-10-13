# 2026-10-13 — LSH: 300 GDs in one Picking (PI-20261013-1502)

## What happened

LSH (tenant 128671) converted about 250 SOs to Created GDs: GD-2610-244 … 543, 300 GDs and 2,147
lines. Then they converted all 300 GDs to Picking by zone, as Full Picking. They all landed in one
Picking, PI-20261013-1502, with 2,096 lines.

The confirm, PICKING run `2109686904730554369` (prod v77, 2026-10-13 00:45), got partway:

- It wrote the Picking (Completed, 2,096 records) and the GD lines (all picking-Completed).
- It then died at `search_node_SiblingPickings`, Full Picking's sibling lookup. The lookup is
  `gd_no in [300 ids]`, which becomes 300 `JSON_CONTAINS` ORs over every LSH Picking. That hit
  the 30 s statement timeout.

It never ran the rest of the confirm, so in prod now:

- all 300 GD headers still have `picking_status = 'Created'`;
- there are 0 Packings for them;
- the Picking still has `is_processing = 1`.

Nothing was picked twice, and every line is on exactly one Picking.

Plan and the follow-up fixes are in `~/.claude/plans/so-this-is-a-starry-anchor.md`.

## Files

| File | What |
|---|---|
| `PICKING.BASE.json` | prod PICKING v77 as enabled (the code the repair replays). Never deploy it. |
| `build_repair_sql.py` | Generates R1: replays v77's Packing code on the failed run, self-checks, and previews every row. |
| `repairs/R1_lsh_300gd.sql` | The repair, for Bytebase. |
| `build_picking.py` | Builds the PICKING hotfix into `Picking/PickingProcessWorkflow.json` (and its `.PROD.json` twin). |
| `test_picking.py` | Replays every changed node against recorded prod and dev runs. Read-only. |

## PICKING hotfix (prod and dev, one file)

**File:** `Picking/PickingProcessWorkflow.json`. It is built on dev's enabled v149, which is prod
v77 plus the 2026-10-12 safety net. So prod also gets the safety net:
- a normal pick writes only the GD header, instead of re-saving every GD through GOODS_DELIVERY;
- Force Complete, loading-bay moves and bin/batch moves are refused on a GD above 500 lines.

**What changes:**

1. **Full Picking sibling lookup.**
   - Before: `search_node_SiblingPickings` was a search-node. The platform runs a search-node
     as one query that LEFT JOINs both Picking subforms, with one `JSON_CONTAINS` per GD. With
     300 GDs this hit the 30 s limit. A Picking that already has 2,096 lines and 2,096 records
     would also blow up that join on its own.
   - Now: `sql_node_SibRecs` returns only the other Pickings' records for this run's GD lines:
     0.3 s for PI-20261013-1502.
   - `code_node_MNRecompute` reads those rows. It also skips a line whose recount equals what
     `code_node_iES7iMKA` already wrote; on the 300-GD confirm that is all 2,096 lines.
     - Skipping is safe when two sibling Pickings confirm together. The run that writes the
       line last always sees the other run's records, so its recount differs from what it
       wrote, and it writes.
2. **The Picking Plan twin.** `search_node_PpSiblings` becomes `sql_node_PpSibRecs`, and
   `code_node_AGoxWP7x` reads its rows. `to_no` holds numbers and `gd_no` holds strings; both
   queries match either form.
3. **GD headers.**
   - Before: the per-GD loop pasted the entire GD list into `code_node_9rK80jNQ` on every
     pass (300 passes × about 9 MB, and the platform logs each one).
   - Now: `code_node_GdPlan` routes every GD once.
     - All header-only writes go in one update.
     - The loop runs only for GDs that need the GOODS_DELIVERY sub-workflow or a skip note, in
       GD order, so the verdict's first failure code is unchanged.
     - Each pass reads its own GD from the loop item.
4. **Packing creates.** At most 25 Packings per add-node call (`loop_PkCreates`).

**Checks** (`test_picking.py`, run against recorded runs; every one passes):

- **`code_node_MNRecompute` on the 300-GD run:** the old code writes 2,096 lines, the new code
  skips all of them. Each skipped line equals what was already written.
- **Seven LSH confirms whose GD lines also carry another Picking's records** (the 10-07 split
  picks and the 10-09 duplicate split):
  - the old code's replay reproduces what each run recorded;
  - the sibling query returns every record the old search-node held;
  - the new recount writes the identical line, or skips a line that is already equal.
- **Routing:** `code_node_GdPlan` matches the old per-GD routing on a real run and on three
  variants: a full re-save, auto-complete, a cancelled GD, and a 600-line GD.
- **`code_node_AGoxWP7x`:** identical on a dev Picking Plan confirm.
- **Packing slices:** split and rejoined in order.
- **Lint:** `scratchpad/validate.py` reports nothing new.

**Deploy:**

1. **Dev first.** Paste `Picking/PickingProcessWorkflow.json` into PICKING
   (`2020683258347081730`), enable it, then run `.dbtools/wf --dev deployed
   Picking/PickingProcessWorkflow.json`; it should report IDENTICAL.
2. **Confirm on dev:**
   - a multi-GD Full Picking Picking (Picking Setup `allow_full_picking`);
   - one Picking of an org without Full Picking.
   Check the run's trace: `sql_node_SibRecs` and `code_node_GdPlan` ran, the GD headers are
   rolled up, and a Packing was created per GD.
3. **Prod.** Paste the same file, enable it, then run `.dbtools/wf --prod deployed
   Picking/PickingProcessWorkflow.PROD.json`; it should report IDENTICAL.

## R1: finish the confirm (once, Bytebase)

**Ran 2026-10-13 10:48:21.** The AFTER checks were verified afterwards:

- 300 Packings, PACK-20261013-1009 … 1308;
- 2,096 item rows;
- the GD headers Completed;
- the Picking unlocked;
- no duplicate numbers.

LSH's own Packings carried on at 0509 and 0510.

**What R1 writes, in one transaction:**

- **300 Packings**, one per GD. Item rows are built by v77's own `code_node_pMVdQBEQ` and
  `code_node_gudzrvMQ`, replayed on the failed run's recorded inputs. The fetches that never ran
  are rebuilt from the database the way a search node returns them.
- The rows are the ones `add_node_LcxwYc7z` writes:
  - 2,096 item rows (`packing_jz8m9w3h_sub`), all Fully Picked, 29,548.615 in total;
  - 600 `packing_blade_dept` rows (org and plant);
  - 300 `packing_Customer` rows;
  - 300 `packing_sales_order` rows.
- **300 GD headers:** `picking_status` → Completed. Every line is picking-Completed, so this is
  what the roll-up gives (B3E0 / GOODS_DELIVERY).
- **PI-20261013-1502:** `is_processing` → 0.

**Self-checks the generator runs before writing:**

- **Reference run.** Run `2109783579109232642` created PACK-20261013-0493, which nothing has
  touched since. Replaying that run gives exactly what it recorded. With its GD data rebuilt
  from the database, it gives the same Packing. The rows R1 would write for it equal
  PACK-20261013-0493's rows column for column (header, item, plant ×2, customer, SO).
- **Payload.** 300 Packings with 2,096 item rows. Each row matches its GD line's allocation
  and is Fully Picked. No handling units.
- **Preview.** Every INSERT's SELECT half runs read-only on prod, and every value returned is
  compared with the payload.

**Numbers: `PACK-20261013-NNNN`.**

- The repaired Packings are dated the day of the confirm. Numbering continues after the highest
  PACK-20261013 number at run time.
- If R1 runs **on 2026-10-13 itself**, it skips 500 numbers first: today that gives
  PACK-20261013-1009 … 1308. If it runs on a later day, numbering continues with no gap.
- The platform does **not** read its counter back from `su_code_serial_increment`. After the
  10-08 repair set the counter to 303, the next Packing the platform made (10-09) was still
  number 0302. So SQL cannot reserve numbers there. R1 leaves the counter alone and stays out
  of the platform's way instead:
  - the platform's numbers later on 10-13 cannot reach the skipped range;
  - every number it issues after 10-13 carries a later date.

**Guards:**

- A header is inserted only while its GD is Created and has no live Packing.
- Each child row is inserted only under its own header.
- Ids are fixed: worker 1001, while the platform's ids use worker 33.
- The GD header update applies only while the GD is Created/Created and all its lines are
  Completed.
- The Picking update applies only while `is_processing = 1`.
- A re-run changes nothing.

**Run it:**

1. Run in Bytebase as an admin: the BEFORE checks (B1–B6), then REPAIR, then the AFTER checks
   (A1–A5).
2. All checks were run read-only on prod at generation time and returned what their comments
   say. B6 shows the numbers.
3. The file is about 940 KB. If Bytebase refuses it, run the statements in order in smaller
   pieces. Every statement is guarded, so this is safe.
4. Created as `create_user` joseph (whose confirm failed), `created_by` "joseph",
   `created_at` 2026-10-12. That date is the same UTC-date quirk the run itself writes.

**Not touched (same as the add-node):** the GD lines' `packing_status` and the GD header's
`packing_status`. PACKING_SAVE stamps those when LSH saves or completes each Packing.

## SO → GD in bulk (step 3)

**What changes:**

1. **GOODS_DELIVERY (`code_node_QtyCheckBatch`).** Before: an SO line deleted after the convert
   read it made this node throw "sales order line … was not found". A throw ends the caller's
   whole run, and on 10-13 it lost SO_AUTO_GD the rest of a 250-SO batch. Now it returns
   `soLineMissing`. The new `if_SoLineGone` returns 400 with "Row N (item): its sales order line
   no longer exists…", before any write, like the item-not-found guard beside it. The GD form
   now gets that message instead of a script error.
   - Dev and prod differ elsewhere, so each is built on its own enabled version:
     - dev v239 → `Goods Delivery/GDheadWorkflow.json`;
     - prod v174 → `Goods Delivery/GDheadWorkflow.PROD.json`.
2. **SO_AUTO_GD.** `sql_node_Items` no longer has `LIMIT 500`; above 500 distinct items the rest
   went missing. Dev and prod both run v16, so one file serves both:
   `Goods Delivery/SOconvertGDCreatedWorkflow.json`.
3. **SO list page, `func_handleConvertGD`.** Identical in dev v528, prod v259 and the repo file
   `Goods Delivery/GDhandleConvertSOtoGD.js`. The Multiple-GDs convert to Created now:
   - calls SO_AUTO_GD for **5 sales orders at a time**, one call after another;
   - updates the loading text after each call ("Converting to Goods Delivery: 25 of 250 sales
     orders done…");
   - lists a call with no answer under "Not converted" and goes on with the rest;
   - stops at the first call that a setup check refuses;
   - refuses a second click while a conversion is running.

   Converting again is safe. An SO whose lines are already covered is reported as "Nothing left
   to deliver".

**Checks:**

- `test_so_to_gd.py` replays `code_node_QtyCheckBatch` on recorded prod runs:
  - **The two runs that threw on 10-13:** the old code throws; the new code returns the 400.
  - **12 successful runs from seven tenants:** the output is identical to what they recorded.
- `test_convert_client.js` runs the handler against a fake page: batches of 5/5/2, one call with
  no answer, a setup refusal, a second click while running, and a small selection.
- The linter reports nothing new.

**Deploy (dev first):**

1. GOODS_DELIVERY (`2017151544868491265`):
   - dev ← `Goods Delivery/GDheadWorkflow.json`;
   - prod ← `Goods Delivery/GDheadWorkflow.PROD.json`.
2. SO_AUTO_GD (`2076557490389835777`), dev and prod ← `Goods Delivery/SOconvertGDCreatedWorkflow.json`.
3. Sales Order list page (`1901872125787099137`), event `func_handleConvertGD`, dev and prod ←
   `Goods Delivery/GDhandleConvertSOtoGD.js`.
4. Check: `.dbtools/wf --dev|--prod deployed <file>` should report IDENTICAL.

## Convert to Picking (step 4): PICKING_LOOP

**File:** `Picking/PickingLoopWorkflow.json` (and its `.PROD.json` twin, same content). One file for
both environments: dev v85 and prod v40 are identical. Built by `build_picking_loop.py`, checked by
`test_picking_loop.py`.

**What changes:**

- **`code_node_1HuvfKMv`** lists each GD, line and Picking Plan once, digits only. The 300-GD convert
  wrote the 300 GD headers 2,096 times, which took 77 s of its 190 s.
- **`sql_node_StampState` + `code_node_StampPlan`** read the current status of those rows. Only rows
  still waiting for a Picking are stamped Created: Not Created, Cancelled, or empty.
  - The four update-nodes are keyed on id lists, so the platform ignored their status filters. A
    Full Picking remainder convert used to reset In Progress and Completed lines and headers to
    Created.
  - Each update now writes exactly its list and is skipped when the list is empty.
  - The quoted filter values (`'Not Created'` including the quote marks) are fixed.
- **Smaller payloads:**
  - `code_node_hjAwTKzF` takes its Picking from the loop item. It read the whole `arrayData` on
    every pass.
  - `code_node_uPSc7Syb` no longer reads `arrayData`.
  - CHECK_REQUIRED_FIELD gets a placeholder item list instead of all the lines. It only checks the
    list is not empty; for the LSH convert that cut its input from 1.2 MB to 110 characters.

**Checks:**

- **`code_node_hjAwTKzF`:** same output on the LSH convert's request (plus `itemCount`).
- **CHECK_REQUIRED_FIELD:** same verdict for 2,096 lines, no lines, and a missing list.
- **`code_node_1HuvfKMv`:** the same GD and line ids, with 300 header writes instead of 2,096.
- **`sql_node_StampState`:** 0.3 s on prod for 300 GDs and 2,096 lines.
- **`code_node_StampPlan`:** stamps only Not Created, Cancelled or empty rows.
- **Lint:** clean.

### Client: the GD list's Convert to Picking

`ConvertToPicking.js` (`buildConsumedQtyMap`) and `SplitPickingAssigneeConfirm.js`
(`getConsumedTotals`) work out how much of each GD line other Pickings already hold. Both are
identical in dev v390, prod v178 and the repo.

**What changes:**

- **Reads per GD.** Each GD's Pickings are read in up to three projected reads:
  1. their statuses first; a GD with no Pickings stops here;
  2. the records of the Completed Pickings;
  3. the lines of the open Pickings.

  Before, one read named both subforms, so the server joined every line with every record.
- **Concurrency.** At most 6 GDs are read at a time; before, one read per GD went out all at once.
- **A Picking covering several selected GDs is counted once.** Before, it was counted once per GD.
  Zone Pickings span GDs, so remainders looked smaller than they are. This was found by the
  simulation and is present in HEAD.
- **A failed read stops the convert.** It shows "Conversion Not Started". Before, the GD was counted
  as having nothing picked, which could convert already-picked quantity again.

**Check:** `test_convert_picking_client.js` runs the git HEAD and the working copy on the same fake
table:

- the results are identical, except that a shared Picking is now counted once;
- no read names both subforms;
- a GD with no Pickings takes one read;
- at most 7 reads are in flight, against 40 before;
- a failed read stops the convert.

**Deploy (dev first, then prod):**

1. PICKING_LOOP (`2021065804251615233`) ← `Picking/PickingLoopWorkflow.json`.
2. Goods Delivery list page (`1902688873696313346`):
   - `func_bulkConvertPicking` (key `kru6fle6`) ← `ConvertToPicking.js`;
   - `onClick_confirmAssignee` (key `8x957a7o`) ← `SplitPickingAssigneeConfirm.js`.
