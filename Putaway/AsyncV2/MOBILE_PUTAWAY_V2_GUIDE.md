# Putaway V2 — Mobile Implementation Guide

> **Audience:** the engineer moving the mobile app's Putaway confirmation (`sudu-mobile-expo`,
> `src/features/wm/putaway/`) to the background completion, and making the Putaway screens work with 2,000+ lines.
> **Server side:** on dev since 2026-10-15 and on prod since the 2026-10-22 full deployment, with the same workflow ids.
> The desktop Putaway form uses it on both. Nothing here needs a server change; if you find you need one, ask the owner
> of `Putaway/AsyncV2/` (session "PO GR Putaway V2").
> **Mobile:** the `hotfix/v2-background` OTA (2026-10-25) moves the app's Putaway to V2 on prod (Part 7).
> **Read with:** `README.md` in this folder (what the server does, what it refuses, test results).

---

## The load-bearing idea

Today mobile sends the whole Transfer Order to **PUTAWAY_LOOP** (`2031190421336195074`) with
`{ arrayData, saveAs: "Completed", pageStatus: "Edit", confirmed_by }`. PUTAWAY_LOOP refuses a confirmation of
more than **500 lines** (dev). Even below that it takes about 0.75 s per line, while the phone waits.

V2 changes what mobile sends and when it waits:

1. **SUBMIT:** send a compact confirmation (per stored line id: quantity, bin, storage location, category, remark) to
   **PUTAWAY_ASYNC_SUBMIT**. It checks everything the classic save checks, against the **stored** pending
   quantities, and answers within about 2 s at 2,000 lines: `QUEUED`, or a refusal with the classic's own message.
2. **Kick the worker and follow the job:** start **PUTAWAY_ASYNC_WORKER** `{ job_id }` for that job, then follow it to
   its end (Part 5). Do not wait on the kick and do not treat its timeout as a failure. The worker moves the stock
   (about 85 s at 2,000 lines on dev), writes records, in-transit rows and the GR status, then marks the job COMPLETED.
3. **STATUS:** ask PUTAWAY_ASYNC_SUBMIT `operation: "STATUS"` whenever you need to know where a TO stands.

Mobile never computes stock, records or statuses. When SUBMIT answers `NOT_ELIGIBLE`, run today's classic call
unchanged, for at most 500 rows.

## Part 1 — Workflow ids (dev and prod)

| Workflow | Id | Call it |
|---|---|---|
| PUTAWAY_ASYNC_SUBMIT | `2110545826201112577` | SUBMIT a confirmation; STATUS of a TO or a job |
| PUTAWAY_ASYNC_WORKER | `2110545857423511553` | `{ job_id }` right after QUEUED; `{}` (all due jobs) when the list opens |
| PUTAWAY_LOOP (classic) | `2031190421336195074` | only after NOT_ELIGIBLE, exactly as today |

All three go through the existing `ServiceUtils.runWorkflowById(id, params, token)`. The answer is the usual envelope;
the workflow's fields are in `data` (e.g. `res.data.route`).

## Part 2 — SUBMIT

```jsonc
{
  "operation": "SUBMIT",
  "to_id": "2110625387005267969",          // the TO's id (string, digits)
  "idempotency_key": "PWC:<org>:<to_id>:<hash>:<gen>",
  "confirmed_by": "<user nickname>",       // the server cannot read the session nickname
  "request": {
    "source": "MOBILE",                    // recorded only
    "lines": [
      { "id": "2110625387013656579", "qty": 2.25, "target_location": "2018912822846582786",
        "storage_location": "2018912759311265793", "target_inv_category": "Unrestricted", "remark": "" },
      // a split line: one entry per split row, each naming the stored line it splits
      { "parent_id": "2110625387013656580", "qty": 5, "target_location": "<bin id>", "storage_location": "<sl id>" },
      { "parent_id": "2110625387013656580", "qty": 2.5, "target_location": "<bin id>", "storage_location": "<sl id>" }
    ],
    "ref_doc": [ { "key": "...", "url": "...", "link": "...", "name": "...", "originalName": "...", "extname": "image/jpeg", "fileId": "*",
                   "size": 1024, "fileType": "image", "status": "success", "percent": 100, "domain": "..." } ]
  }
}
```

Rules for `request.lines`. The server enforces them; build them right the first time.
- One entry per row to put away **now**; rows with quantity 0 are left out. A line not mentioned puts nothing away.
  Partial confirmations are fine: the line keeps the remainder pending and the TO goes In Progress.
- `id` = the **stored line id** (`transfer_order_putaway_jz8m9w3h_sub.id`). Mobile already holds it on each row and
  strips it before the classic call; V2 needs it.
- A line is either put away whole (exactly one entry with `id`) or split (one or more entries with `parent_id` = that
  line's id, in split order). Never both, never the same `id` twice.
- `qty` is a number > 0, in the line's UOM, at most the line's stored pending quantity in total.
- `target_location` / `storage_location`: id strings. **Always send them for split rows**: a split row without them
  gets an empty bin and is refused. For a whole line, an omitted field keeps the stored value.
- `target_inv_category`: `Unrestricted`, `Reserved`, `Blocked`, `Quality Inspection` or `In Transit`. Keep the QI
  lock you already have, and never send `""`.
- At most **2,500 rows** per confirmation. Above that, ask the user to confirm part of the lines first, as desktop
  does.
- `ref_doc` (optional): the putaway's attachments as the user leaves them. Send the **whole list**, meaning what the TO
  already had plus the files uploaded on this confirmation, in the file-object shape `handleConfirmV2` builds today.
  - The server replaces the stored list with it at SUBMIT, before the stock moves.
  - Leave the key out to keep what is stored; `[]` clears the list.
  - At most 100 files.
  - Include the list in what your idempotency hash covers.

**Idempotency key:** one per tap and content, 8–128 characters of `A-Z a-z 0-9 | : _ . -`. Build it as
`PWC:<organization_id>:<to_id>:<hash of {to_id, header update_time as loaded, lines}>:<generation>`. The hash can be
any stable string hash (desktop uses FNV-1a + djb2, 16 hex chars).
- A network error or lost answer: send the **same** key once more. The server finds the same job and never creates
  two.
- After an answer of `FAILED` for that key, increase the generation (a new key = a new attempt).
- Never start a key with `PWS:`; that prefix is reserved for STATUS-only calls (Part 4).

## Part 3 — SUBMIT answers

| `data.route` | `code` | What it means | What mobile does |
|---|---|---|---|
| `QUEUED` | 200 | job created (`job_id`, `job_status`, `to_no`) | kick the worker `{ job_id }` without awaiting it and follow the job (Part 5); toast "TO … is being completed in the background"; leave the screen |
| `STATUS` | 200 | this key already has a job (`job_status`, `progress_message`, `error_message`) | QUEUED / VALIDATING / READY_TO_COMMIT / COMMITTING_PUTAWAY → same as QUEUED; COMPLETED → "already completed"; FAILED → show `error_message`, next tap uses the next generation |
| `BUSY` | 409 | another completion of this TO is open | show `message`; do **not** loop on it (a job can run for minutes) |
| `NOT_ELIGIBLE` | 300 | V2 does not take this TO (`reason`) | run the classic PUTAWAY_LOOP call for it, unchanged |
| `STOP` | 400 / 500 | refused: same codes and texts as the classic (over pending qty, missing bin, Completed, locked …), or 500 "could not be queued" | show `message`; nothing was written |
| `REJECT` | 400 | malformed request (your bug) | show `message`, log it |

NOT_ELIGIBLE today covers:
- a TO not saved yet, or a Draft;
- item bundles;
- split rows stored without confirming them;
- handling units;
- serial-numbered items;
- a costing-migration item without a unit price.

Above 500 rows those answer `STOP` with the reason, since the classic cannot take them.

**Several TOs in one confirmation** (mobile's `arrayData` can hold more than one): send one SUBMIT per TO. Then:
- kick the worker for each QUEUED one;
- send the NOT_ELIGIBLE ones together in one classic call, as today;
- report each TO's outcome.

The classic PUTAWAY_LOOP answers "under processing" while a V2 job of that TO is open. Your `runWithLockBusyRetry`
already absorbs that; cap it as it is.

## Part 4 — STATUS and the open job

```jsonc
{ "operation": "STATUS", "to_id": "<to id>", "idempotency_key": "PWS:<org>:<to_id>", "confirmed_by": "",
  "request": { "source": "MOBILE", "lines": [] } }
```

The answer's `job_status` is the TO's latest job:
- `QUEUED`, `VALIDATING`, `READY_TO_COMMIT`, `COMMITTING_PUTAWAY` → running. Show the TO read-only with a banner ("being
  completed in the background", plus `progress_message`) and kick the worker `{ job_id }` again.
- `REQUIRES_REVIEW` → stopped half-way; the TO stays locked. Read-only, banner "please contact support".
- `FAILED` → nothing was moved and the TO is unlocked. Show `error_message` once per job on this device, then allow
  confirming again.
- `COMPLETED` or no job → normal.

Call it when a TO is opened for putaway (before allowing input), and to follow each job you start (Part 5).

## Part 5 — Kicking the worker (there is no scheduler)

There is no scheduled worker. A job moves only when a client starts PUTAWAY_ASYNC_WORKER. A job that has to wait
(a counted retry, or the stock engine's lock wait under load) is picked up again only by the **next** kick. So the
client that starts a job also follows it:
- **Follow every job you queue:** `{ job_id }` at once, then STATUS (Part 4) every 10 s, kicking `{ job_id }` again
  while it is running. Stop at a final status (COMPLETED / FAILED / REQUIRES_REVIEW), after 3 min without progress, or
  10 min in all. Kick and STATUS calls get their own timeouts; a timed-out kick is not a failure, since the server
  finishes the run anyway. Mobile: `followPutawayJob` (commit `2b9c7e55`).
- When a running job is found on open (Part 4): kick `{ job_id }` again.
- When the Putaway **list** opens: `{}` (every due job) at most once every 2 minutes per device, **one call, no loop**,
  then refresh the list.
- Never loop on `data.processed`: it counts the jobs a run **selected**, not the ones it finished (found 10-25). An
  id-less run starts no new job after its time budget, so a list kick is a sweep, not a guarantee; the follower is what
  moves a job to its end.

## Part 6 — Building the confirmation from mobile state

Map each stored line's put-away instances to entries:
- **one instance** with qty > 0 → `{ id: line.id, qty, target_location, storage_location, target_inv_category, remark }`;
- **split into several instances** → one `{ parent_id: line.id, qty, … }` per instance with qty > 0, in order;
- bundle / HU / serial rows → no special handling; the server answers NOT_ELIGIBLE and you go classic;
- a row without a stored line id (a TO not saved yet) → classic directly, no SUBMIT.

Do not fetch `table_putaway_records` (`getPutawayRecordsById`) for V2: the server writes the records itself, keyed
per job line, and replays safely.

## Part 7 — Gating

- Switch `PUTAWAY_V2_ENABLED`: **on for dev and prod** with the `hotfix/v2-background` OTA (user's call, 10-24). The
  server workflows are the same on both (checked 2026-10-25: prod = dev = repo for SUBMIT v5, WORKER v3, PREPARE v5,
  COMMIT v8). With the switch off, today's classic call is used as is.
- Fall back to classic **only** on an explicit `NOT_ELIGIBLE` answer, or when the switch is off. Never fall back
  after a network error or a missing answer; repeat SUBMIT with the same key instead. The classic would run on top of
  a job that may already be queued. The server refuses that double post, against the stored pending quantities, but
  the user would see an error.
- Mixed fleet (phones on the old build next to phones on the OTA, plus desktop): classic PUTAWAY_LOOP v19, on prod
  and dev, answers "The current putaway is under processing" while a V2 job of that TO is open (REQUIRES_REVIEW
  included) or its GR is still `Processing`. That holds even after the TO's `is_processing` lock passes its 900 s stale
  limit, and nothing is written.
- PUTAWAY_LOOP refuses a Completed confirmation of more than 500 lines. That's expected: those TOs need V2.

## Part 8 — 2,000+ lines on the phone (required)

The server is proven at 2,000 lines (and 2,500 rows per confirmation). The screens must be too. What I saw at mobile
`dev` HEAD `c5db1a90` (verify, line numbers drift):

| Where | What breaks at 2k | Do |
|---|---|---|
| List: `getTransferOrderPutawayViewData` (`transfer_order_putaway.utils.ts` ~l.373) | fetches `table_putaway_item` with joins (`goods_receiving, Customer, bin_location, unit_of_measurement, batch`) for **every TO on the page** | list header fields only; load lines when one TO is opened |
| Open: PO details (`PutawayAdd.tsx` ~l.629, `getPurchaseOrderById` per distinct PO) | downloads each whole PO; one 2,000-line PO = all its lines | one projected read (`id,purchase_order_no` and whatever is displayed) with an id list |
| `ConfirmPutaway.tsx` (~l.878, `ScrollView` + nested `.map`) | mounts every row at once | virtualize it (`FlatList` / FlashList), or show a per-TO summary and expand on demand |
| `PutawayAdd.tsx` `FlatList`s (~l.4982, ~l.5612) | virtualized already; risk is every row re-rendering on each keystroke / scan | memoized row component with primitive props, stable `keyExtractor` (line id + instance), state in a keyed map, tuned `initialNumToRender` / `windowSize` |
| Route params `putawayData`, `locationQuantities`, `binLocations`, `locationKeys` (JSON strings) | stringify / parse of 2k-line state on every navigation, and kept in navigation state | hand over through a store (or context) keyed by TO id; pass only ids in params |
| Lookups in render / validation / scan matching | `find` / `filter` over all lines per row = O(n²) | build index maps (by line id, item + batch, bin) once per load |
| Confirm payload | classic sends the whole TO | V2 sends ~150 bytes per row (~300 KB at 2k) |

Shared lookups are fine as they are: `ServiceUtils.getDataByServiceName` is a POST with a 5,000-row default limit, so
one request with 2,000 ids works (`getItemDetailsByIds`, `getBinLocationByIds`, …). Keep them one request each, in
parallel, as `PutawayView` already does.

**Targets on a mid-range Android, 2,000-line TO:**
- the TO opens and is usable in under 5 s;
- scrolling has no visible jank;
- typing a quantity or scanning reacts in under 100 ms;
- SUBMIT is answered in under 5 s;
- the app's memory stays flat after opening and closing the TO twice.

Measure before and after, and report the numbers.

## Part 9 — Test plan (dev)

1. Small TO, whole lines → QUEUED → worker → COMPLETED. On the server: TO Completed; records; in-transit rows
   Received; GR putaway status.
2. A split line (two bins) → both rows land, each with its own quantity. This is the 2026-10-09 split bug's shape, so
   check the quantities.
3. A partial confirmation, then the rest.
4. A TO with an HU, bundle or serial line → NOT_ELIGIBLE → classic, unchanged.
5. Open a TO while its job runs → read-only banner. A FAILED job (e.g. move the source stock first) → reason shown
   once, then a retry with a new key.
6. A lost answer (airplane mode right after the tap) → the retry with the same key gets STATUS, and there is exactly
   one job.
7. **2,000-line TO**: open, scroll, enter quantities (auto-location for the whole TO), split a few lines, confirm, and
   watch it complete. Ask the Putaway V2 owner ("PO GR Putaway V2") for a fresh one, created in tenant 000000, plant
   `1123598813738675202` (putaway on, in-transit, batch items). Report the Part 8 numbers.

To check results on the server, ask the Putaway V2 owner for the job's status and the reconcile (movements, records,
in-transit, GR).

## Part 10 — Attachments, and what stays classic

- **Attachments are saved now (2026-10-16).** Until then they were silently dropped on Completed, on both paths.
  - V2: send `request.ref_doc` (Part 2). Key absent = keep the stored list; a list replaces it.
  - Classic: PUTAWAY_LOOP v19 (dev and prod) **adds** the files in `arrayData[].ref_doc` to the stored list on
    Completed (de-duplicated by url / link / key); `[]` or absent changes nothing, and nothing can be removed on this
    path. Today's app (sends `[]` or only the new files) is therefore safe. Sending stored + new also works.
- Mobile V2 for HU, bundle and serial putaways: those stay classic, at most 500 rows.
