# Picking V2 — Mobile Implementation Guide

> **Audience:** the engineer moving the mobile app's Picking confirmation (`sudu-mobile-expo`) to the background save,
> and making the Picking screens work with 2,000+ lines.
> **Server side:** built, deployed and tested on **dev** (stages 1a, 1b, 1c; 2026-10-12 to 2026-10-16). The web
> Picking form already uses it. Nothing here needs a server change; if you find you need one, ask the owner of
> `Picking/AsyncV2/` (session "GD Edit & Picking V2").
> **Prod:** next week's full deployment promotes dev to prod as it stands, so these workflows (same ids) reach prod
> then. The mobile switch (Part 7) decides when the phone uses them; the user decides when it goes on for prod.
> **Read with:** `README.md` in this folder (what the server does, what it refuses, live test results). Match the
> conventions mobile Putaway V2 and Packing V2 already use (`Putaway/AsyncV2/MOBILE_PUTAWAY_V2_GUIDE.md`,
> `Packing/AsyncV2/MOBILE_PACKING_V2_GUIDE.md`) wherever this guide leaves a choice.

---

## The load-bearing idea

Today mobile sends whole Pickings to **PICKING_LOOP** (`2021065804251615233`) with
`{ arrayData: [picking, …], saveAs: "Completed", pageStatus: "Edit", confirmed_by }`. PICKING_LOOP re-saves the
Goods Delivery synchronously while the phone waits; on a large GD that took dev down (2026-10-09), and PICKING refuses a
move on a GD above 500 lines.

V2 changes what mobile sends and when it waits:

1. **SUBMIT:** send a compact confirmation (per stored Picking line: quantity, pick unit, the bin / batch it was picked
   from) to **PICKING_ASYNC_SUBMIT**. It checks the Picking, its setup and its jobs, and answers in well under a second:
   `QUEUED`, a refusal with the classic's message, or `NOT_ELIGIBLE` (use the classic call).
2. **Kick the worker:** start **PICKING_ASYNC_WORKER** for that job, fire-and-forget. The worker validates against
   the **stored** Picking, moves stock when a line was picked into another bin or batch, writes the records, the
   lines, the GD lines and headers, and the Packing, then marks the job COMPLETED (about 2 s for a few lines; 35 s for
   2,000 lines on dev).
3. **STATUS:** ask PICKING_ASYNC_SUBMIT `operation: "STATUS"` whenever you need to know where a Picking stands.

Mobile never computes records, statuses or stock. When SUBMIT answers `NOT_ELIGIBLE`, run today's classic call
unchanged for that Picking.

## Part 1 — Workflow ids (dev; the same ids on prod after the full deployment)

| Workflow | Id | Call it |
|---|---|---|
| PICKING_ASYNC_SUBMIT | `2109531449614647297` | CONFIRM a Picking; STATUS of a Picking |
| PICKING_ASYNC_WORKER | `2109531412499251201` | `{ job_id }` right after QUEUED or on open; `{}` (all due jobs) when the list opens |
| PICKING_LOOP (classic) | `2021065804251615233` | only after NOT_ELIGIBLE, exactly as today |

All three go through the existing `ServiceUtils.runWorkflowById(id, params, token)`. The answer is the usual envelope;
the workflow's fields are in `data` (e.g. `res.data.route`). A workflow answers HTTP 200 even when it refused: read
`data.route` / `data.result_code`.

## Part 2 — SUBMIT (CONFIRM)

```jsonc
{
  "picking_id": "2111025445871943682",            // transfer_order.id of the Picking (digits)
  "organization_id": "1901545950162329602",       // the Picking's organization_id (digits)
  "operation": "CONFIRM",
  "idempotency_key": "PKC:1901545950162329602:2111025445871943682:3f2a9c1e5b7d4a60:1",
  "confirmed_by": "<user nickname>",              // the server cannot read the session nickname
  "payload": "{\"lines\":[…],\"header_patch\":{}}" // a JSON STRING, as the web form sends it
}
```

`payload.lines`, one entry per picked row:

```jsonc
{ "row_id": "2111025446010355714",          // the stored Picking line id (transfer_order_jz8m9w3h_sub.id)
  "qty": 5,                                 // picked now, in pick_uom (> 0; a 0 row is left out)
  "pick_uom": "2021056571405717508",        // the unit the user picked in (picking_uom; the line's unit if none)
  "target_location_id": "2046110685065560066", // the scanned bin (= the source when nothing moved; the bay bin on Loading Bay); "" = none
  "target_batch_id": "2056989951844626434",    // the scanned batch (= the stored batch when nothing moved); "" = none
  "remark": "", "remark_2": "", "remark_3": "", // only the ones edited on Confirm
  "attachment": [] }                            // only when the line has photos
```

Rules. The server enforces them; build them right the first time.
- One entry per **stored** line picked **now**. Partial picks are fine: the line keeps the remainder pending and the
  Picking goes In Progress. A line not mentioned picks nothing.
- `row_id`, `pick_uom`, `target_location_id`, `target_batch_id`: digits only, or `""`. Anything else (a bin code, a
  batch number) is refused with 400, so send ids, never labels.
- **Targets.** A key that is present is what the user picked: send `target_location_id` = the scanned bin (equal to
  the source when nothing moved; on Loading Bay, the bay bin) and `target_batch_id` = the scanned batch, or `""` when
  there is none. A target equal to the source is not a move (SUBMIT's test: both set and different). A key that is
  absent means "use what is stored on the line". Send both keys on every line, so the server never falls back to a
  stale stored target.
  - A different bin or batch than the allocation is a **move**. The server releases the old reservation and allocates
    at the picked bin / batch (a swap), or, for a Loading Bay organization, moves the reserved stock to the bay bin.
    Nothing to do on the phone besides sending the target.
- `qty` is a number; the server clamps an over-pick to the line's stored pending quantity and reports it (Part 4).
- At least one line with `qty > 0`; at most **2,000** lines per confirmation.
- `header_patch`: the header fields the user changed on ConfirmPicking for this Picking. The server accepts the 49
  header columns classic writes (`HEADER_FIELDS` in `code_node_PPplan`: `ref_doc`, `remarks` / `_2` / `_3`,
  `delivery_method` / `_text`, `area_id`, `project_id`, the 13 `di_*` and 28 older delivery columns); mobile edits
  `area_id`, `project_id`, the `di_*`, `remarks` and `ref_doc`. A key that is present is written as sent (even `""` or
  null); an absent key keeps the stored value (P1 writes all 49 as the Picking read at commit ⊕ the patch). So:
  - send a field only when the user changed it versus the loaded head record; never send a field the head fetch did
    not load;
  - header `remarks` is one input shared by every Picking in the confirmation: it starts empty, and when typed it is
    sent to each of them; otherwise left out;
  - `ref_doc` replaces the stored list whole: send stored + new, only when a file was added.
  - Classic writes all 49 columns straight from `allData` (PICKING `update_node_JBvmArxy` / `update_node_o19MykBA`,
    prod v81 = dev v154): an empty **or omitted** value clears the stored one. In a prod sample (400 mobile
    PICKING_LOOP runs over 7 days; 320 stored Pickings confirmed), 319 left `ref_doc` out, 312 left `remarks` out,
    none sent `remarks_2`, `remarks_3` or the 28 older delivery columns, and 248 sent `area_id` empty or not at all.
    Tenant 128671's unconfirmed Pickings all carry `area_id`; 0 of its 220 mobile-confirmed ones still do. So today's
    mobile confirm wipes these whenever the Picking had them. V2 with the rules above does not.
  - Classic Cancel (or any save other than Completed of a stored Picking) never reaches PICKING: PICKING_LOOP's own
    `update_node_LKW2Upgf` writes 68 header columns from the item (the 49 plus `organization_id`, `plant_id`,
    `gd_no`, `so_no`, `customer_id`, `assigned_to`, `created_by`, `table_picking_items` / `records`, ...).
- Line `remark` / `remark_2` / `remark_3`: send a key only when the picker edited that field on Confirm (clearing it
  counts, `""`); a missing key keeps the stored value. Classic always sends all three.
- `attachment` (line photos): an array → those photos on the record; absent → the record takes the line's stored
  photos; `[]` → none. After a pick the line's own photos are cleared, as classic does (PICKING `code_node_Z5JH4g2u`
  / `code_node_hojzwwoL`). Send it only when the line has photos. (Classic's record took `item.attachment || []`
  (`code_node_oHIIKfiw`), so a confirmation that left the photos out saved records without them.)
- **Several Pickings in one confirmation** (today's `arrayData` can hold more than one; 6 of the 314 mobile
  confirmation calls in the prod sample): send one SUBMIT per Picking (Part 3).

**Idempotency key:** one per tap and content, **16–128 characters of `A-Z a-z 0-9 : _ | -`** (no `.`; this differs
from Putaway, whose sanitizer lets `.` through). Build it as Putaway V2 does (`buildPutawayV2Key`):
`PKC:<organization_id>:<picking_id>:<hash16(canonicalJson({picking_id, update_time, lines, header_patch}))>:<gen>`,
with `update_time` = the Picking header as loaded. A content key matters here: SUBMIT carries lines, so quantities
edited after a lost answer get a new key (and the open-job refusal) instead of the first job back.
- A network error or lost answer: send the **same** key once more. The server finds the same job (`EXISTING`) and
  never creates two.
- After `EXISTING` with `FAILED` / `REQUIRES_REVIEW` (400), increase the generation (a new key = a new attempt).
- No bump after `REJECT`: no job was made under that key.

## Part 3 — SUBMIT answers

Every answer carries `route`, `result_code`, `result_message`, `job_id`, `job_status`.

| `data.route` | `result_code` | What it means | What mobile does |
|---|---|---|---|
| `QUEUED` | 200 | job created; the Picking is now locked (`is_processing = 1`) | kick the worker `{ job_id }` without awaiting it; toast "Picking … is being saved in the background"; leave the screen |
| `EXISTING` | 200 / 400 | this key already made a job (`job_status`) | running status → same as QUEUED; `COMPLETED` → "already saved"; `FAILED` / `REQUIRES_REVIEW` (400) → show `result_message`; the next tap uses the next generation |
| `NOT_ELIGIBLE` | `NOT_ELIGIBLE` | V2 does not take this Picking (`result_message` says why) | run the classic PICKING_LOOP call for this Picking, unchanged |
| `REJECT` | 400 | refused before anything was written (no job, no lock) | show `result_message`; only "under processing" is worth an automatic short retry with the **same** key (below) |
| no data / no route / a throw | — | no answer | resend once with the same key, then ask STATUS: running → as QUEUED; else "No answer — tap again", keep the key; never classic |

`NOT_ELIGIBLE` today covers, among others: a Draft Picking; Picking Setup "picks after Sales Order" (Picking Plan);
Auto Complete GD; a move together with Full Picking, a handling unit on the moved line, serial-numbered items or select
picking on the moved delivery, or internal-trading linkage. The server decides; mobile only falls back.

`REJECT` texts you will meet (shown as they are):
- "This Picking is still being confirmed in the background (job …). Wait a moment, then reopen it." — a job is open.
- "Picking is under processing. Please try again later." — the classic save holds it. The refusal comes before any
  job is made, so retrying with the same key is safe: reuse `runWithLockBusyRetry`, with a Picking predicate on
  `data.route === "REJECT"` and `/under processing/i` on `data.result_message` (the envelope differs from
  PUTAWAY_LOOP's `code` / `message`).
- "Goods Delivery … is being saved in the background. Wait a moment, then try again." — a GD V2 job holds a GD.
- Loading Bay: "Loading Bay is enabled but Target Location is missing (or the same as the source bin) on these picked
  items: … Set a loading bay bin on every picked line before completing." — every picked line needs its bay bin.
- Moves: more than 25 moved deliveries or 500 moved-delivery lines in one confirmation; a moved delivery being
  confirmed on another Picking.
- 400s from a malformed request (a non-id unit or target, no picked line, a bad key): your bug, log it.

**Several Pickings:** SUBMIT each one, kick the worker for each QUEUED one, then run **one PICKING_LOOP call per
NOT_ELIGIBLE Picking** (not one call for all of them): PICKING_LOOP stops at the first Picking that fails, after the
ones before it were saved, so separate calls give each Picking its own outcome and make a lock-busy retry safe.
- **Hold a classic Picking that shares a delivery with one just queued** (e.g. A queued, B NOT_ELIGIBLE, same GD):
  run B's classic call only after A's job reaches a final status (STATUS every ~2 s with a kick, up to ~60 s; a small
  job finishes in 2–3 s). Classic PICKING does not see another Picking's V2 job, writes the GD line and header
  statuses once without a read-back, and V2 recomputes the header from the lines it reads, so interleaved they can
  leave the header status stale; a move on either side sends the V2 job to review. If A is not final in time, tell the
  user to confirm B again in a moment. Pickings with no shared delivery run classic right away.
- Local pre-check before SUBMIT: unsaved / Draft only (as desktop); everything else goes to SUBMIT.

## Part 4 — STATUS and the open job

```jsonc
{ "picking_id": "<picking id>", "organization_id": "<org id>", "operation": "STATUS" }
```

The answer is the Picking's latest job: `job_id`, `job_status`, `result_code` (the job's error / notice code) and
`result_message`.
- `QUEUED`, `VALIDATING`, `READY_TO_COMMIT`, `COMMITTING_PICKING` → running. Show the Picking read-only with a banner
  ("being saved in the background", plus `result_message`) and kick the worker `{ job_id }` again. A job waiting for
  a retry or for stock locks held by another operation (`PK_STEP_RETRY`, `PK_LOCK_WAIT`) only moves when someone
  kicks it.
- `REQUIRES_REVIEW` → stopped half-way; the Picking stays locked. Read-only, banner "please contact support".
- `FAILED` → nothing was written and the Picking is unlocked. Show `result_message` once per job on this device, then
  allow confirming again.
- `COMPLETED` → normal. If `result_code` is `PK_CLAMPED`, a picked quantity was reduced to what was pending: show
  `result_message` once.
- no job (`job_id` "") → normal.
- These seven are the only values Picking V2 writes. `CANCELLED` is never written for a Picking job (there is no
  cancel); if support ever sets it by hand, treat it, and any other unknown value, as final and log it.
- `PK_LOCK_WAIT` / `PK_STEP_RETRY` arrive on a running job (`COMMITTING_PICKING`): show them as progress and kick; no
  toast. FAILED (its reason) and PK_CLAMPED are the only results to report once per job.

Call it when a Picking is opened (before allowing input). Optionally also while the user stays on a Picking they just
submitted (every 5–10 s, stop at a final status).

## Part 5 — Kicking the worker (there is no scheduler)

A job moves only when a client starts PICKING_ASYNC_WORKER:
- right after QUEUED: `{ job_id }`, fire-and-forget through a plain fetch (not `runWorkflowById`, whose slow-network
  toast fires after 5 s); the server finishes even if the phone gives up; never treat its timeout as a failure;
- one live kick per job (an in-flight set, as Packing V2): again on open and on every STATUS poll that still reads
  running (Part 4), since a retry wait or a stock-lock wait only moves on a kick;
- when the Picking **list** opens: `{}` at most once every 2 minutes per device (AsyncStorage
  throttle key, e.g. `pkv2_worker_kick_at`; report-once key `pkv2_seen_<job_id>`). While `data.processed > 0`, call again, up to 5 rounds (the worker takes up to 5 jobs per
  call), refreshing the list after each productive round. Desktop's Picking form does the `{ job_id }` kick on open.

## Part 6 — Building the confirmation from mobile state

From what prod mobile sends to PICKING_LOOP today (400 prod mobile runs over 7 days: 314 confirmations of stored
Pickings, 920 picked lines, 49 of them moved), each picked item maps 1:1:

| PICKING_LOOP item field (today) | V2 line field |
|---|---|
| `id` | `row_id` (each Picking's own stored line id; CP's `id` can be another Picking's line in the merged case) |
| `picked_qty` (> 0) | `qty` |
| `picking_uom` (or `item_uom`) | `pick_uom` |
| `target_location` (the scanned bin; on Loading Bay the bay bin, while `_mobile_locations[0].location_id` stays the source) | `target_location_id` (`""` when empty) |
| `target_batch` | `target_batch_id` (`""` when empty) |
| `remark`, `remark_2`, `remark_3` | the same, only the ones edited on Confirm (Part 2) |
| `attachment` | the same, only when the line has photos |

- A row whose `_mobile_locations` has **more than one** entry, or an `_is_split_entry` row: V2 takes one bin per row,
  so send that **Picking** to the classic call (none seen in the prod week, but the app can produce them).
- Bundle parent rows (`item_bundle_id` without `item_code`) and header rows (`row_type: "header"`): leave them out; the
  server derives bundles from their children.
- Do not send records (`table_picking_records`), statuses or quantities left: the server computes them.
- A Picking not saved yet (no stored line ids) → classic directly, no SUBMIT.

**Where it is built today** (`src/features/wm/picking/`, as of mobile `3bb2f573`; line numbers drift):
- PickingList `handleBatchPicking` (PL:1468) → PickingAdd (`pickingData`, the Pickings trimmed to the ticked lines,
  as a JSON route param) → PickingAdd `handleConfirm` (PA:7866-8170) → ConfirmPicking (CP:193-212) →
  `handleSubmitV2` (CP:1667) → `transformToWorkflowInput` (CP:980-1362) → `runWithLockBusyRetry(runWorkflowById(
  "2021065804251615233", { arrayData, saveAs: "Completed", pageStatus: "Edit", confirmed_by }))` (CP:1635,
  1829-1854). The id is also hard-coded in `hooks/usePickingBulkActions.ts:9` (Force Complete: stays classic).
- The row id is `item.picking_item_id || lineId` (CP:1107); `picked_qty` is in the pick UOM (CP:1062-1068);
  `target_location` / `target_batch` come from the per-Picking entry (CP:1118-1119); remarks are always sent.
- Swaps: under Soft / None a scan of another bin, or the location / batch modal, sets target ≠ source (and
  `target_batch` when a batch was chosen); `_mobile_locations[0].location_id` then holds the NEW bin. Classic builds
  records from `item.source_bin` + `item.target_location` and does not read `_mobile_locations` on that path; V2 reads
  the same pair (the stored source + the sent target). 1c's parity proof ran on 20 recorded prod classic runs, 8 of
  them 035843 mobile swaps of exactly this shape.
- Loading Bay: the bay bin is stamped into `target_location` when it is empty or equals the source (PA:1885-1913).
- Splits (`is_split` + `split_locations` → N rows with the same stored id, `_is_split_entry`, `split_data`;
  CP:818-855, 1084-1102): send that Picking to classic without a SUBMIT, as desktop does.

**Defects V2 must not copy** (found in the mobile survey):
- **Merged line:** the same GD line on two selected Pickings merges into one item (PA:1460); the second Picking's
  entry carries the first Picking's line id (PA:1553-1567), and its header id / `di_*` can go out empty. V2 carries
  each Picking's own line ids. (No such shape in a prod week of mobile confirmations: no row id under two Pickings.)
- **Context:** every `arrayData` entry gets the first Picking's `organization_id` / `to_status` / `ref_doc_type`
  (PA:8129). V2 takes each Picking's organization from its own head record.
- **Batch on split rows:** each split row carries the parent's `target_batch` (CP:828). Classic only.

## Part 7 — Gating

- A switch built like Putaway's / Packing's (`picking/config/pickingV2.ts`, `isPickingV2Enabled(NetworkConfig.backendUrl)`):
  **true only for the dev backend** (`https://dev.mes.sudu.ai`, keyed on the backend URL, not the app variant); prod
  stays classic until the user decides, after the full deployment (a one-line OTA once the prod ids are checked by
  name). With it off, today's classic call is used as is.
- Fall back to classic **only** on an explicit `NOT_ELIGIBLE`, or when the switch is off. Never fall back after a
  network error or a missing answer: repeat SUBMIT with the same key. The classic would run on top of a job that may
  already be queued (the server refuses it: "Picking is under processing"), and the user would see an error.

## Part 8 — 2,000+ lines on the phone (required)

The server is proven at 2,000 lines per Picking (web form and worker). The phone's Picking list and Picking screen
must be too. Apply what Putaway V2 learned (its guide, Part 8): load list headers only and lines when a Picking opens;
virtualized, memoized rows with stable keys; index maps instead of `find` / `filter` per row; no large JSON in route
params; one batched lookup per kind.

**Targets on a mid-range Android, 2,000-line Picking:** opens and is usable in under 5 s; no visible scroll jank;
a scan or a quantity reacts in under 100 ms; SUBMIT answered in under 5 s; memory flat after opening and closing the
Picking twice. Measure before and after, and report the numbers.

**What breaks at 2k today** (mobile survey, before measuring):
- List `getTransferOrderPickingViewData` (`utils/transfer_order_picking.utils.ts`): fetches `table_picking_items` for
  every Picking on the page, reloads on every focus, twice on pull-to-refresh; Tasks runs it over 100 Pickings; no
  `organization_id` / `update_time` in its field list; an expanded card mounts every line; select-all / Batch Picking
  are O(n²).
- Hand-off: whole documents as JSON route params (2–4 MB at 2k) on List → Add, Add → Confirm, Tasks → Add; the deep
  link fetches with no field list.
- PickingAdd: `handleQuantityChange` (PA:2658-2675) scans `Object.entries` on every keystroke / scan / bundle child;
  the rebuild does O(n²) `find`s; a location scan does a `find` that never matches (PA:4296) then a full regroup; the
  open waits behind a 30 s timeout.
- ConfirmPicking: each carousel page is a ScrollView with every line and 3 remark inputs per line (6,000 inputs at 2k).
- PickingView: the records tab is a ScrollView.

Plan (Putaway's recipe): header-only list and Tasks queries, lines on demand; a store hand-off with ids in params;
one fetch by ids and a projected head fetch; O(n) indexes in PickingAdd; a virtualized ConfirmPicking with memoized
cards; paged expanded list cards.

## Part 9 — Test plan (dev, tenant 496474)

Tell the server owner before each live batch: some cases need dev setup changes (a yes from the user each time).

1. **Normal pick:** a Created Picking, pick 1 of 2 lines → QUEUED → worker → COMPLETED; the Picking In Progress, the
   GD line's picking status, the record with `confirmed_by`.
2. **Partial + alternate unit:** pick in a pack unit; the record's `picked_uom` and base quantity.
3. **Swap:** scan another bin for line 1 and another batch for line 2 → COMPLETED; the reservation and the GD line's
   allocation follow the picked bin / batch (compare with the classic twin, as in README "Live twins").
4. **Loading Bay** (needs 496474's first Picking Setup row switched to Loading Bay for the test, then back): every
   line to a bay bin → COMPLETED; a line without a bay bin → the REJECT text above.
5. **Several Pickings in one confirmation:** two Pickings → two jobs; one of them NOT_ELIGIBLE (if available) → classic
   for that one only.
6. **Same tap twice / no network:** resend the same key → `EXISTING`, one job.
7. **Open while running:** STATUS shows the banner, the worker kick moves it on; FAILED shows its message once.
8. **2,000-line Picking:** the targets in Part 8, then a confirmation of all lines.
9. **Switch off:** today's classic path, unchanged.

Test data already on dev 496474 (from the server's live tests): PI-20261016-0072 (GD/20261016/075, Created, 2
lines: Normal Item and Auto Batch Item, both allocated in bin L1). Ask the server owner for more (SO clones →
deliveries → Pickings).

## Part 10 — Force Complete (stage 1d: on dev since 2026-10-20, web switches ON since 2026-10-21)

Today the Picking list's "⋮" menu (`usePickingBulkActions.handleBulkForceComplete`) calls classic PICKING_LOOP with
`isForceComplete: 1`. The background version reduces each delivery to what was picked (unpicked lines removed, their
reservations released, the sales order given the quantity back), then completes the Picking. **Switch it on only after
the web version passed its live tests and your own device pass**; until then keep today's call.

**SUBMIT** (one idempotency key per tap, reused on a retry):

```jsonc
{ "picking_id": "<picking id>", "organization_id": "<org id>", "operation": "FORCE_COMPLETE",
  "idempotency_key": "PKF:<org>:<picking>:<random>", "payload": "{}", "confirmed_by": "<user nickname>" }
```

The answer: `route` QUEUED | EXISTING | REJECT | NOT_ELIGIBLE, `result_code`, `result_message`, `job_id`, `job_status`,
`classic_ok`.

- **QUEUED / EXISTING** → follow the job (below).
- **NOT_ELIGIBLE** with `classic_ok` "1" → today's PICKING_LOOP call for that Picking, unchanged. With "0" (more than
  500 lines or 25 deliveries in total: too big for the classic path) → show `result_message`, no classic call.
- **REJECT** → show `result_message` (e.g. not In Progress, more than 25 deliveries / 2,000 lines, nothing picked).

**Following the job.** There is no scheduler, and a force complete takes several steps:
- `PICKING_ASYNC_WORKER { job_id }` right after QUEUED, fire-and-forget;
- STATUS every 3 s while the job is open; STATUS now also answers `operation` ("FORCE_COMPLETE"),
  `progress_percent` and **`kick`** (an array of edit job ids);
- for every id in `kick`: `GD_EDIT_WORKER { job_id: <id> }` (`2110618789356687361`), fire-and-forget, at most one call
  in flight per id; when that call answers, kick `PICKING_ASYNC_WORKER { job_id }` again (the force complete's next
  step is waiting for it);
- re-kick `PICKING_ASYNC_WORKER { job_id }` every 15 s; follow while it moves: stop after 180 s without progress
  (a GD_EDIT_WORKER call still running counts as progress) and after 15 minutes in all ("still being saved in the
  background: keep this screen open, or open it again, to let it finish"); opening the Picking again resumes it.

**Results** (STATUS `job_status`):
- `COMPLETED` → `result_message` is the summary ("PI-x force completed: N deliveries updated, R line(s) reduced,
  X removed").
- `FAILED` → nothing was saved; show `result_message` once. The Picking is unlocked and stays In Progress.
- `REQUIRES_REVIEW` → stopped half-way (some deliveries already reduced); the Picking stays locked: "please contact
  support" with `result_message`.

**Seen live on dev 496474 (2026-10-21):** a 1-delivery force complete takes about 12 s and 8 calls; a 2,000-line one
took 238 s and 13 calls, its delivery's GD_EDIT_WORKER commit call alone 186 s. Treat GD_EDIT_WORKER as
fire-and-forget and expect such a call to outlive the phone's HTTP timeout: the server run continues and STATUS shows
it. Two saves of the same item at once serialize on the stock engine's lock (one edit commit waited 173 s).

The other parts of this guide apply unchanged: one live kick per job, report-once keys, and NOT_ELIGIBLE → classic.
Revert Completed must refuse a Picking whose latest job (STATUS) has `operation` FORCE_COMPLETE and is COMPLETED
("This Picking was force completed: its deliveries were reduced. Create a new delivery from the sales order for the
rest.").
