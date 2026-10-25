# Packing V2 — Mobile Implementation Guide

> **Audience:** the engineer moving the mobile app's Packing "Save as Completed" (`sudu-mobile-expo`,
> `src/features/wm/packing/`) to the background completion. Branch: `feature/v2_background`, where Putaway V2 already
> lives — follow its pattern (`putaway/config/putawayV2.ts`, `utils/putaway_v2_workflow.utils.ts`,
> `hooks/usePutawayWorkerKick.ts`).
> **Server side:** built, deployed and tested on **dev** (2026-10-13 → 10-15: 2-line, 2,000-line, batch, fallback and
> re-kick tests all passed). The desktop Packing form already uses it. Nothing here needs a server change; if you find
> you need one, ask the owner of `Packing/AsyncV2/` (the Packing V2 session; names change on restart).
> **Prod:** live on prod with the **same workflow ids** as dev, and identical to dev since 2026-10-25 13:21 (SUBMIT v7,
> WORKER v5, PREPARE v7, COMMIT v9). Whether the prod bundle turns V2 on is the user's OTA decision (Part 7).
> **Read with:** `README.md` in this folder (what the server does, what it refuses, test results).
> **Independent of Picking V2:** Packing V2 only needs the GD lines to be picked (`picking_status = Completed`), which
> the classic Picking and Picking V2 both write. Mobile Picking V2 being on hold does not block this.

---

## The load-bearing idea

Today mobile's Save as Completed (`usePackingFormSubmit.saveAsCompleted`) checks the form, completes any pending HUs
one at a time (`rowActions.completeRow`, which also writes the settled HU rows onto the Packing), then sends the whole
Packing to **PACKING_VALIDATION** (`PACKING_SAVE`, `1994279909883895810`) with `saveAs: "Completed"`. That save
re-saves the whole Goods Delivery while the phone waits: on prod a 74-line Packing took 96 s, and it refuses more than
**500 GD lines**.

V2 keeps everything up to the last call and replaces only that call:

1. **SUBMIT:** send the Packing id (plus the remarks) to **PACKING_ASYNC_SUBMIT**. It reads the Packing, its HU rows and
   the GD from the database, checks what the classic save checks, and answers in well under a second for a small
   Packing (2.5 s at 2,000 lines): `QUEUED`, or a refusal with a message, or `NOT_ELIGIBLE`.
2. **Kick the worker:** start **PACKING_ASYNC_WORKER** for that job, fire-and-forget. It moves the reserved stock into
   the HUs, re-points the reservations, updates the GD lines, the SO and the Packing, then marks the job COMPLETED
   (about 4 s for a few lines, about 3.5 min at 2,000 lines).
3. **STATUS:** ask PACKING_ASYNC_SUBMIT `operation: "STATUS"` whenever you need to know where a Packing stands — in
   particular when a Packing is opened.

Mobile never computes stock, reservations or statuses. When SUBMIT answers `NOT_ELIGIBLE`, run today's classic call
unchanged, on the same tap.

## Part 1 — Workflow ids (dev and prod: the same)

| Workflow | Id | Call it |
|---|---|---|
| PACKING_ASYNC_SUBMIT | `2109924558618333185` | COMPLETE a Packing; STATUS of a Packing |
| PACKING_ASYNC_WORKER | `2109924593737240578` | `{ job_id }` right after QUEUED, and when an open job is found; `{}` (up to 5 due jobs) when the list opens |
| PACKING_VALIDATION (classic) | `1994279909883895810` | only after NOT_ELIGIBLE, exactly as today |

All go through `ServiceUtils.runWorkflowById(id, params, token)`. The workflow's fields are in `data`
(e.g. `res.data.route`).

## Part 2 — SUBMIT (COMPLETE)

```jsonc
{
  "operation": "COMPLETE",
  "packing_id": "2068918273225719810",        // the Packing's record id (digits, as a string)
  "organization_id": "1123598813738675201",   // digits
  "idempotency_key": "PKM:2068918273225719810:<gen>",  // 16-128 chars of A-Z a-z 0-9 : _ | -
  "header_patch": "{\"remarks\":\"...\"}",    // JSON string; see below
  "submitted_name": "<user nickname>"         // the workflow cannot read the session nickname
}
```

- **What it reads:** the Packing as STORED. The HU rows must already be saved as Completed, which `completeRow`
  already does (its persist step writes the settled rows). Send nothing else: no table_hu, no entry.
- **header_patch:** the header fields the user may have changed. The server writes only these 16, and a key you leave
  out keeps its stored value: `remarks, remarks_2, remarks_3, di_shipping_method, di_driver_name, di_ic_no,
  di_driver_contact_no, di_shipping_company, di_transport_name, di_vehicle_number, di_est_delivery_date,
  di_est_arrival_date, di_pickup_date, di_validity_of_collection, di_tracking_number, di_freight_charges`. Mobile edits
  only `remarks`, so send `{ "remarks": form.remarks }`. Do not send the `di_*` values back (mobile shows them only).
  Not written by V2: `packing_mode` (same as desktop V2).
- **idempotency_key:** one per completion attempt of one Packing. Make it once, keep it (memory + AsyncStorage, keyed
  by packing id) and send the SAME key again after a lost answer; drop it after any definitive answer (QUEUED, EXISTING,
  NOT_ELIGIBLE, REJECT). The same key never queues a second job: the server answers with the first one.
- **The lease:** SUBMIT accepts a Packing whose live lease is held by the same user (that is you). It refuses only a
  live lease of ANOTHER user. Call it while your lease is active, as the classic save is (`ensureActiveLease`).

## Part 3 — SUBMIT answers

Every answer has `route, result_code, result_message, job_id, job_status`.

| `route` | Meaning | Do |
|---|---|---|
| `QUEUED` | A new job; the server took the Packing's lock for it (below) | Part 5 "after QUEUED" |
| `EXISTING` | This key already made a job (a retried tap) | `job_status` open → same as QUEUED; `COMPLETED` → success; `result_code "400"` (FAILED / REQUIRES_REVIEW) → show `result_message` |
| `NOT_ELIGIBLE` | The background save does not handle this Packing | Run the classic `runSave("Completed")` now, unchanged. Log `result_message` |
| `REJECT` | Refused, nothing written (`result_code "400"`) | Show `result_message`, stay on the screen, lease untouched |

NOT_ELIGIBLE cases: a Draft Packing; no Goods Delivery; serial-managed items; items with no base unit or an
unsupported costing method; batch or serial balance rows the stock engine cannot move; a previous job that failed
`PK_NOT_SUPPORTED`. REJECT cases (messages are user-ready): Packing completed / cancelled / not found; GD not Created;
GD lines not fully picked; another completion of this GD still running or under review; another background save on the
GD; "This Packing is open on mobile by <name> (until <time>)".

Lost answer (exception, timeout, empty `data`): send once more with the same key. Still nothing → "No answer from the
server. Tap Completed again — the same packing is never completed twice." **Never** fall back to the classic call, and
**do not** put a V2 submit in the outbox (the key already makes a retap safe; the outbox replays whole-document
snapshots).

## Part 4 — STATUS and the open job

```jsonc
{ "operation": "STATUS", "packing_id": "<id>", "organization_id": "<org>" }
```

Answers the Packing's latest job: `job_id`, `job_status`, `result_code` (= the job's error code), `result_message`.
`job_id ""` = no job ever.

| `job_status` | On opening the Packing |
|---|---|
| `QUEUED`, `VALIDATING`, `READY_TO_COMMIT`, `COMMITTING_PACKING` (running) | Read-only, no lease. Banner "Being completed in the background." Kick `WORKER { job_id }` (Part 5). Poll STATUS every ~8 s while the screen is open; on `COMPLETED` reload the Packing (it is now Completed). |
| `REQUIRES_REVIEW` | Read-only, no lease. "The last completion stopped half-way and is under review: <result_message>. Please contact support." |
| `FAILED` | Show `result_message` ONCE per job id (AsyncStorage `pkgv2_seen_<job_id>`), then open normally. Nothing was written by a FAILED job, and its lock was given back. |
| `COMPLETED`, `""` | Open normally. |

Run STATUS and the lease `enter` in parallel to save the round trip, and let STATUS decide: if STATUS says running or
REQUIRES_REVIEW and `enter` happened to succeed (possible once the job's lock has expired, below), call `leave` and go
read-only.

**The lock while a job runs.** On QUEUED, SUBMIT overwrites the five `packing_lock_*` columns:
`packing_lock_user_id = <job id>`, `packing_lock_user_name = "Background save"`,
`packing_lock_session_id = "PKGJOB-<job id>"`, expiry now + 30 min (server time). The job gives it back when it
finishes (COMPLETED or FAILED); REQUIRES_REVIEW keeps it. So while a job runs, any device's `enter` answers
`PACKING_IN_USE` with `lockedBy: "Background save"`, and your own `keepAlive` / `leave` no longer match (keepAlive
answers the "KeepAlive - Extend Lock … 未找到符合条件的数据" 400 that `PackingSessionUtils.keepAlive` maps to
`PACKING_SESSION_EXPIRED`). After 30 minutes the lock expires even if the job is still open — which is why STATUS, not
the lock, decides read-only.

The list can show such a Packing as "Completing…" when `packing_lock_session_id` starts with `PKGJOB-` and the lock
has not expired (the status column stays `Created` until the job ends).

## Part 5 — Kicking the worker (there is no scheduler)

No Quartz row runs this worker (by decision: it is expensive). Jobs move only when a client kicks them.

- **After QUEUED / EXISTING-open:** stop the lease first — no more `keepAlive`, and do not call `leave` (the lock is the
  job's now; your session must not report "expired" to the user). Toast "Packing submitted. It is being completed in
  the background." Kick `WORKER { job_id }` **without awaiting it** in the UI flow, go back to the list, and refresh the
  list when the worker answers (`data.job_status === "COMPLETED"`). A timeout of that call is not a failure: the run
  continues on the server.
- **Opening a Packing with a running job:** kick `WORKER { job_id }` (Part 4). A second kick while a run holds the job
  does nothing (the claim is unique per job version), so kicking on every open is safe.
- **Follow your own job:** after QUEUED, re-kick `WORKER { job_id }` while STATUS says it is running (about every 10 s,
  for up to about 3 min), even after going back to the list. A stock lock conflict makes the job wait 2, 4, then 8 s
  for its next try, and only a new kick runs it (at LSH about 1 engine call in 5 met a lock conflict in the week of
  10-22). After 3 conflicts the job ends FAILED, "the stock stayed busy … complete the Packing again": nothing was
  moved, the lock is back, and tapping Completed again (a new key) is the retry.
- **List mount:** one `WORKER {}` per device every 2 min at most. It drains up to 5 due Packing jobs of the tenant.
  Do not repeat it on `data.processed > 0`: `processed` counts the jobs the run SELECTED, so a job another device is
  running keeps it above 0. Refresh the list when a job in `data.jobs` has a `job_status` different from its `before`.

WORKER answer: `worker_route` (`WORKED` / `IDLE` / `REJECTED`), `processed`, `job_id`, `job_status`, `result_code`,
`result_message`, `packing_id` (first job of the tick), `jobs` (JSON string of all of them).

## Part 6 — Where it goes in the code

- `saveAsCompleted` (`usePackingFormSubmit.ts`): keep the pre-check, the pending-HU confirm + `completeRow` loop and
  the post-check exactly as they are. Replace only the final `runSave("Completed")` with: V2 enabled → SUBMIT (Part 2/3),
  else `runSave("Completed")`. NOT_ELIGIBLE → `runSave("Completed")`.
- Draft and Created saves, Complete HU / Unload, the outbox: unchanged.
- Packing open (`PackingSessionProvider` / `usePackingSessionLease` / `PackingForm` + `PackingView`): Part 4.
- Packing list (`PackingList.tsx`): the list kick (Part 5) and the "Completing…" badge.
- New: `config/packingV2.ts` (ids, switch, statuses, intervals) and `utils/packing_v2_workflow.utils.ts`
  (submit / status / kick + answer classification, unit-tested like `putaway_v2.utils`).

## Part 7 — Gating

Same switch as Putaway: by the bundle's backend URL, never by app variant. Off = today's behaviour, byte for byte.
Dev and prod use the same workflow ids, so no per-backend id map is needed. Turning it on for prod
(`https://main.mes.sudu.ai`) is the user's decision. Phones on an older build keep the classic save next to V2 ones:
the Packing lock (`PKGJOB-<job>`), PACKING_SESSION and PACKING_SAVE's guards keep the two from completing one Packing
twice.

## Part 8 — Large Packings on the phone (measure, then decide)

The server handles 2,000 lines (tested). On the phone, the pending-HU loop persists the settled HU rows after EVERY HU
(`completeRow` → `persistSettledRows`, which writes `table_hu` + `table_hu_source` + `table_item_source`); with many
source rows and several pending HUs that is one whole-subform write per HU. The desktop V2 handler completes the HUs one
at a time and writes the Packing ONCE at the end (also in `finally`, so HUs completed before a failure are kept).
Measure a large Packing on dev first; adopt the single write only if the loop is slow.

## Part 9 — Test plan (dev)

The server owner can stage data on dev (fresh Created Packings with a fully picked GD, or a QUEUED job left with no
worker run) — tell them the tenant / org the test phone logs into.

1. **Small V2:** 2 HUs, Save as Completed → `QUEUED`, back to the list, the Packing shows Completed within seconds, no
   "session expired" toast. The server owner checks the database (stock moved into the HUs, reservations, GD lines,
   SO, Packing).
2. **Re-kick:** a staged QUEUED job with no worker run → open it on the phone → read-only + banner → completes → reload.
3. **Second device:** while a job runs, open the Packing on another phone → read-only from STATUS (and `enter` says
   `PACKING_IN_USE` by "Background save").
4. **Fallback:** a Draft Packing (or one with a serial item) → NOT_ELIGIBLE → the classic save completes it on the same
   tap.
5. **Refusal:** a Packing whose GD is not fully picked → the server's message, nothing written, still editable.
6. **Lost answer:** airplane mode during SUBMIT, then retap → the same key → EXISTING, one job only.
7. **V2 off:** a prod/staging bundle → classic save unchanged.
