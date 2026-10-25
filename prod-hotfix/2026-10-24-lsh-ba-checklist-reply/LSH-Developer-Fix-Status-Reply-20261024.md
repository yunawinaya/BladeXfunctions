# LSH Food — developer fix-status reply

Reviewed by: Developer team (bladexfunctions sessions 22 and 42)

Review date/time (MYT): 24 October 2026, 12:10–12:45. Read-only production checks; the repairs listed were run by our
team's operator. Status is as of 12:45 MYT.

## Developer status summary

| ID | Priority | Issue | Developer status | Owner | Fix / deployment reference | Remaining work / ETA |
|---|---|---|---|---|---|---|
| LSH-OPS-01 | P0 | Packing overwrote workflow checkpoints | **Fixed and verified** | Dev (22) | PACKING_SAVE restored to its pre-guard version (prod v32, live 11:29:49); open jobs repaired by SQL 11:50–12:09; GOODS_DELIVERY and GD_UNUSED_FN_NEW guard code removed 12:36–12:37 | None. The remaining overwritten rows belong to finished jobs only. |
| LSH-OPS-02 | P1 | 20 delivery-creation jobs held | **Fixed and verified** | Dev (22, 42) | GD_BULK_COMMIT fix (10:53); repair SQL resume_19_created + finish_5_handpicked (~12:00–12:09); hold release 12:23; finish_1250 (12:35) | None. At 12:40 LSH has no open delivery job, no waiting or blocked event and no held stock lock. |
| LSH-OPS-03 | P1 | Delivery completion stalls / reservation rejection | **Fixed and verified** | Dev (22) | resume_4_completed SQL; affected Packings re-completed on the restored PACKING_SAVE (~12:00) | Users complete GD-2610-1195 (ready). |
| LSH-OPS-04 | P1 | GD-2610-1034 inventory rejection | **Fixed** (ready to complete) | Dev (22) | PACK-2610-0874 re-completed 11:59:45 | Users complete GD-2610-1034 (and GD-2610-1253, same cause). |
| LSH-OPS-05 | P1 | SI2610-0426 posting lookup | **Not in this team's scope** | Accounting integration | — | Route to the accounting-integration owner. |
| LSH-OPS-06 | P1 follow-up | Historical invoices with blank item codes | **Not in this team's scope** | Accounting integration | — | As above. |
| LSH-OPS-07 | P2 | Item posting price tag | **Not in this team's scope** | Accounting integration | — | As above. |
| LSH-OPS-08 | P2 follow-up | TMS updates failing; GD-2610-967 assignment | **Needs investigation** (outbound) / **Not fixed** (inbound) | Not yet assigned | — | Code fix in VERSA_FLEET_POST, then re-push 5 GDs; manual driver/vehicle fix for GD-2610-967. |
| LSH-OPS-09 | P2 | PO item lines missing arrival dates | **Fixed and verified** (new saves) | Dev (42) | PO_SAVE fix live in production since 24 Oct 12:47:56 | None. The 90 earlier lines are not backfilled; re-saving such a PO fills them. |

## LSH-OPS-01 — packing checkpoint overwrite

- Developer status: **Fixed and verified.**
- Correction and production deployment reference / time:
  - The writer was the "borrowed guard" added to PACKING_SAVE, pasted at 11:06.
  - PACKING_SAVE was restored to its 10-21 pre-guard version. It has been live since 11:29:49 and is identical to that
    version (the editor only added an empty `blocks` field).
  - No checkpoint overwrite has happened since 11:28:11.
  - The 22 stock locks the guard leaked were released at 11:32:29.
  - GOODS_DELIVERY and GD_UNUSED_FN_NEW also carried guard code (inactive without the Packing guard). Both were restored
    to their pre-guard versions at 12:36–12:37 (prod v182 and v53, verified). No guard code is left in the three
    workflows.
- Checkpoint recovery scope / remaining affected jobs:
  - Every job that was still open and affected was repaired: 4 completion jobs and the creation jobs under LSH-OPS-02.
  - The about 11,000 rows still carrying the overwrite belong to finished jobs or released operations. No running
    workflow reads their status, so the point-in-time database restore is **not needed**.
- Verification:
  - PACKING_SAVE has run since the restore without failures.
  - The 4 completion jobs (GD-2610-1069, 1088, 1138, 1165) completed 11:53–11:54. Each stock movement was posted once
    (8 and 11 movements), with no doubles.
- Remaining work / owner / ETA:
  - None for operations.
  - The guard was also removed from dev (11:33–11:37), so a dev-to-prod promotion cannot reintroduce it. It will be
    rebuilt later.
- Prevention:
  - A read-only production health check now runs in seconds. It covers what was pasted, mass writes, stuck or
    under-review jobs, held stock locks, crashes, and delivery stock against reservations.
  - The workflow checker now rejects the kind of update step that caused the overwrite. A scan of all 544 production
    workflows found no other.

## LSH-OPS-02 — delivery creation held after inventory processing

- Developer status: **Fixed and verified.** All 20 done.
- Correction and production deployment reference / time:
  - GD_BULK_COMMIT fix (blank planned quantity) has been live since 10:53.
  - Repair SQL ran about 12:00–12:09 (resume_19_created and finish_5_handpicked) and at 12:35 (finish_1250).
- Recovered GD numbers / evidence:
  - **14 resumed, creation jobs COMPLETED 12:01–12:06:** GD-2610-1224, 1226, 1232, 1237, 1241, 1243, 1244, 1263, 1269,
    1273, 1274, 1281, 1282, 1290. Their SO planned quantities were added after checking each SO line still lacked
    exactly that delivery's quantity.
  - **5 picked and packed by hand while held:** GD-2610-1212, 1221, 1258, 1270, 1279.
    - SO planned quantities were added (23 of 23 lines verified).
    - Every allocation has its reservation.
    - All 5 creation jobs are COMPLETED as of 12:27.
  - **GD-2610-1256:** a hand-placed hold on its Picking event was released at 12:23, and it closed at 12:26:58
    (COMPLETED).
  - **GD-2610-1254:** the same hold, released at 12:23. It closed at 12:29:10 (COMPLETED) and is Created, ready to
    complete.
  - **GD-2610-1250:** its job carried a manual-recovery note ("GD1250_20261024") written directly into the database at
    11:02:56. No one claimed it, so it was repaired the same way (finish_1250). Its job COMPLETED at 12:35.
  - LSH has no automatic Picking, so no Picking was missing for any of these.
- Remaining work / owner / ETA:
  - None. At 12:40 LSH has no open delivery-creation job, no waiting or blocked Picking event and no held stock lock.

## LSH-OPS-03 — completion stalls / reservation-plan rejection

- Developer status: **Fixed and verified.**
- Correction scope and deployment reference / time:
  - There was no general reservation-planning defect. These completions failed because their Packings were saved on the
    broken guard version (11:14 and 11:16).
  - Those saves wrote the GD lines onto the packed box while the reservations and stock stayed in the old bins.
  - Re-completing the Packings on the restored version (about 12:00) moved the reservations and stock onto the box.
- Latest result for each listed GD / run or job IDs:
  - GD-2610-1069, 1088, 1138, 1165: completed 11:53–11:54. The LOCK_WAIT errors were the leaked guard locks, released at
    11:32:29.
  - GD-2610-1142: Completed at 12:08. Completion job 2113844951434530817 COMPLETED. All 8 lines delivered, the 7
    reservations Delivered, and SO-Jimmy-040805 Fully Delivered.
  - GD-2610-1195: Created and ready to complete.
- Remaining work / owner / ETA: users complete GD-2610-1195.

## LSH-OPS-04 — GD-2610-1034 inventory rejection

- Developer status: **Fixed** (ready to complete).
- M3 finding / correction:
  - Same cause as LSH-OPS-03. PACK-2610-0874's save at 11:09:06 failed at the guard, so there was no stock at the packing
    location for movement M3.
  - The Packing was re-completed at 11:59:45, and the lines now match their reservations on the box.
  - GD-2610-1253 (PACK-2610-1096) had the same problem and was fixed the same way.
  - A tenant-wide scan found no others: GDs 1156, 1217 and 1286 had already been re-completed by users and are consistent.
- Latest GD result: Created; its creation job is COMPLETED.
- Remaining work: users complete GD-2610-1034 and GD-2610-1253.

## LSH-OPS-05 / 06 / 07 — accounting posting

- Developer status: **Not in this team's scope.** These belong to the accounting (AutoCount) integration and were not
  checked. Please route them to its owner.

## LSH-OPS-08 — transport integration

- Outbound developer status / cause / correction: **Needs investigation (code fix required).**
  - Every update to Versa has failed since the switch to the production Versa account: 5 of 5, from 10-23 22:55 to 10-24
    11:04. Creating tasks still works (11:03:32 created 41).
  - Versa's error body is not stored.
  - The only payload change from the last successful update (10-19) is the production configuration. `customer_id:
    291195` is now sent on updates, and the template / time-window / custom-field ids are new.
- Outbound per-GD result / remote response / run reference:
  - Run 2113828846565462018 stopped at its first update (GD-2610-1176) with HTTP 400.
  - GD-2610-1174, 1175, 1182 and 1185 were never sent.
  - No VERSA_FLEET_POST run since 11:04.
- Inbound GD-2610-967 status / assignment verification: **Not fixed.**
  - Completed since 10-23. Its driver and vehicle fields are blank.
  - Its only callback (10-23 08:05) was skipped with "Driver ANDREW not found". The driver matches now, but a re-sent
    callback is also skipped, because the GD is already Completed.
  - Related: the callbacks for the 5 GDs above were also skipped. Versa sends "XIONG 阿雄" while the ERP driver is
    "XIONG", and "JANE" does not exist in the ERP.
- Remaining work / owner / ETA (owner to be assigned):
  1. Capture Versa's actual 400 response.
  2. Most likely remove `customer_id` from the update payload (VERSA_FLEET_POST, node code_node_8OBIBH9R).
  3. Let the run continue past a failed GD, then re-push the 5 GDs.
  4. Set GD-2610-967's driver and vehicle manually.
  5. Align the driver names with Versa.

## LSH-OPS-09 — PO item arrival dates

- Developer status: **Fixed and verified** for new saves.
- Finding:
  - All ten lines are still NULL (`po_expected_date`). They were saved from the PO form by lshteam on 10-24 between 00:01
    and 00:19 and issued directly.
  - The form sent an empty line date, and PO_SAVE only falls back to the header date when the line date is missing, not
    when it is empty.
  - PO2610-0656, saved in the same session without a line date, received the header date correctly.
- Scope: wider than the ten listed. **46 LSH POs / 90 lines** are affected so far, the latest at 12:19 today, and new
  POs keep adding to it until the fix is deployed.
- Correction:
  - PO_SAVE now treats an empty line date as missing, so the line takes the PO's header date.
  - Live on dev since 12:35. A test PO saved with a blank line date received the header date.
  - The backfill copies each affected line's header date. Its preview lists the 90 LSH lines on 46 POs, each with its
    PO's date.
- Production: live since 24 Oct 12:47:56. Verified on 25 Oct: all 24 LSH lines saved since then carry their header date.
- The 90 earlier lines are not backfilled (decision 25 Oct). Re-saving such a PO fills its lines from the header date.

## Earlier fixes — operational closure

| Earlier issue | Developer confirmation / remaining work |
|---|---|
| GD-2610-1100 | **Fixed and verified.** Completed (10:34). All 19 lines delivered; SO-Tom-035881 Fully Delivered (planned 0); the 19 reservations Delivered; stock nets to exactly −56, one delivery movement, no double deduction. |
| SO UOM repair / Reorder Needs Review | **Fixed and verified** for SO units: of 37,529 live LSH SO lines, 0 use a unit that is neither the item's base unit nor one of its conversions, and 0 point at a missing item. The Reorder (Redis) side cannot be checked from the database. |
| Missing 311 items | Prior verification stands. No contrary evidence; every LSH SO line resolves to an existing item. |
| GR label blank preview | Not checked: needs a browser preview and print test. |
| SO→GD `carryDescription` failure | **Fixed and verified.** SO2610-1577 is Completed / Fully Delivered (1 of 1, through GD-2610-1081, Completed 10-23 14:19). |
| GD-2610-1142 batch selection complaint | Completion now done (see LSH-OPS-03). No further allocation follow-up found. |
| Item master editing restrictions | Not checked: needs the specific user and item. |

## Reply summary

```text
Reviewed by / time MYT: Developer team (sessions 22 and 42) / 24 Oct 2026, 12:10–12:45

Fixed and verified: LSH-OPS-01, LSH-OPS-02, LSH-OPS-03; earlier fixes GD-2610-1100, SO UOM, SO2610-1577, GD-2610-1142
Fixed, ready for users: LSH-OPS-04 (complete GD-2610-1034 and 1253); GD-2610-1195 (under OPS-03)
Fixed for new saves: LSH-OPS-09 (PO_SAVE live 24 Oct 12:47:56; the 90 earlier lines not backfilled)
Not fixed: LSH-OPS-08 inbound (GD-2610-967)
Needs investigation: LSH-OPS-08 outbound (Versa update 400)
Not in this team's scope: LSH-OPS-05, 06, 07 (accounting integration)

Production deployment references: PACKING_SAVE restored 11:29:49; GD_BULK_COMMIT fix 10:53; GOODS_DELIVERY and
GD_UNUSED_FN_NEW restored 12:36–12:37
Documents/data already recovered: see OPS-01 to OPS-04
Documents/data still pending: OPS-08 GDs
Verification evidence: per item above
Remaining owner / ETA: OPS-08 owner to be assigned
```
