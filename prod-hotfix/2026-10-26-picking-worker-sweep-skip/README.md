# PICKING_ASYNC_WORKER: list-open runs stop racing a job's own kick, and one job per run, 2026-10-26

**Paste into: PICKING_ASYNC_WORKER (id 2109531412499251201), after LSH's peak (the user's call, 10-26).** Not
PUTAWAY_ASYNC_WORKER or PACKING_ASYNC_WORKER: `wf --prod deployed` can match a kit-built look-alike, so check the
"deployed as" name and id.

## What goes wrong on prod (v4)

- Two worker runs can claim the same job at once:
  - a job's own kick and a Picking list's id-less catch-up kick;
  - or two list opens.
- The unique claim insert stops the loser with a crash at `add_node_PWclaim`. The job itself is fine, but the crash can
  reach the user as an error pop-up, and Auto Pick's own kick then skips its list refresh.
- LSH 10-26: 07:22:47 and 07:22:51 (list runs), and 07:28:19 (PI-2610-3542's own kick; the job completed at 07:28:27).

## The change (one node: `sql_node_PWpoll`)

- **LIMIT 5 -> LIMIT 1** (added 10:58, the stock-lock rule): a run that touched stock keys blocks them until it ends, so
  it takes no second job. Picking's one stock call per job is PM1, for bin / batch moves only, so none at LSH.

- An id-less run (`job_id` empty) leaves a job alone for its first 10 s, and for 10 s after a retry comes due. Its own
  kick or follower takes it. Any run takes it after that.
- A run for a named `job_id` is unchanged.
- Same rule as GD_ASYNC_WORKER's pick (C) and GD_PICKING_OUTBOX_CONSUMER's v14 poll skip.
- `create_time` is compared on the platform's MYT clock (`UTC_TIMESTAMP + 8 h`, right on any session); `next_attempt_at`
  on the session clock `NOW(3)`, like the poll's other conditions.

## Files

| File | What it is |
|---|---|
| `PICKING_ASYNC_WORKER.json` | Paste this. Prod v4 plus the change |
| `PICKING_ASYNC_WORKER.prod_v4.json` | Prod's live v4 (2026-10-20 17:47:52), read 10-26; byte-identical to dev v4 |
| `patch_worker.py` | Builds the paste file from v4 with one exact, counted replacement |

## Evidence

- The patched poll ran read-only on prod (128671, id-less and with a job id) and on dev (496474), each in under 0.4 s.
- The MYT-clock age read right on a live LSH job (10 s for one created 10 s earlier).
- Lint: same findings as v4. test_worker_fc 8/8 passes.
- Dev: published as v5 at 07:49 (the user's yes; backup v4_20261026-074902). Idle smoke OK (worker_route IDLE).
- With LIMIT 1: the paste file equals `patch_worker.py` run on `PICKING_ASYNC_WORKER.prod_v4.json`. test_worker_fc 8/8,
  and the poll ran read-only on prod and dev. Dev v6 at 11:02 (the user's yes; backup v5_20261026-105840), idle smoke OK.

## After the paste

**Pasted 2026-10-26 11:15:02 as prod v6: IDENTICAL.** The hour after: 221 runs, all Complete (no claim crash); 81 LSH jobs
COMPLETED.

Check: `.dbtools/wf --prod deployed Picking/AsyncV2/PICKING_ASYNC_WORKER.json` must say IDENTICAL as
'PICKING_ASYNC_WORKER' (id=2109531412499251201).
