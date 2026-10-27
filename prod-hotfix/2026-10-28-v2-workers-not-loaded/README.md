# 2026-10-28 Five GD V2 workers stuck on "script for node[...] is not loaded" (prod)

**Status:** pastes built 03:58 from the DEPLOYED prod versions; the user pastes them.

## What happened
- Every run of these five workflows fails on its first code node with `script for node[<id>] is not loaded`.
  - **Restart:** prod's JVM started at 01:55:41 MYT (status endpoint, read by the GD session); three workers stuck right after.
  - **CANCEL and REVERT stuck earlier,** at 10-27 21:36:58, with no restart. The only nearby prod changes are two form
    publishes (sm_item_assembly v36 at 21:35:08, sales_order v448 at 21:35:59), so a publish may stick workers that run at
    that moment:

| Workflow | Id | Stuck node | Failing since |
|---|---|---|---|
| GD_ASYNC_WORKER (GD create) | 2104840667119411201 | code_node_1OvNTk9G2 | 01:56:58 |
| GD_PICKING_OUTBOX_CONSUMER (GD → Picking) | 2105134245397041153 | code_node_3wpgxjXW3 | 01:56:58 |
| GD_EDIT_WORKER | 2110618789356687361 | code_node_GEWguard | 01:56:58 |
| GD_CANCEL_WORKER | 2112455700319932418 | code_node_XWguard2 | 10-27 21:36:58 |
| GD_REVERT_WORKER | 2112758130420088833 | code_node_RWguard3 | 10-27 21:36:58 |

- **The workflows did not change:** they're the enabled versions from 10-23..10-27, and they ran fine until the restarts.
  It's the platform bug seen on dev on 10-21 and 10-22: workflows first started at the same moment after a restart keep a
  failed script load until the next restart. Republishing under the same node id doesn't clear it: GD_ASYNC_WORKER was
  republished at 04:01:02 (v18, same content as v17) and still failed at 04:02:09. A new node id does.
- **Running fine:** GD_COMPLETE_WORKER, PICKING_ASYNC_WORKER, the SUBMITs.
- **Already hit (LSH 128671):** GD-2610-1897 and GD-2610-1892 have been Processing since 03:23 and 03:41. lshteam's two
  GD edits (jobs 2115162407994265602, 2115167100472528897) wait QUEUED for GD_EDIT_WORKER. Every new GD create, cancel,
  edit or revert in any tenant would wait the same way.

## The pastes (`rename_stuck_nodes.py`)
- **Each file is the enabled prod version, with only the stuck node's id renamed** everywhere it occurs. The builder asserts
  that renaming it back gives the deployed version exactly. The workflow linter's findings are the same before and after.

| Order | Workflow | Paste | Base (= prod now) | Rename |
|---|---|---|---|---|
| 1 | GD_ASYNC_WORKER | `GD_ASYNC_WORKER.json` | v17 | 1OvNTk9G2 → 1OvNTk9G3 (59) |
| 2 | GD_PICKING_OUTBOX_CONSUMER | `GD_PICKING_OUTBOX_CONSUMER.json` | v14 | 3wpgxjXW3 → 3wpgxjXW4 (36) |
| 3 | GD_EDIT_WORKER | `GD_EDIT_WORKER.json` | v9 | GEWguard → GEWguard2 (38) |
| 4 | GD_CANCEL_WORKER | `GD_CANCEL_WORKER.json` | v6 | XWguard2 → XWguard3 (29) |
| 5 | GD_REVERT_WORKER | `GD_REVERT_WORKER.json` | v7 | RWguard3 → RWguard4 (29) |

**How:**
- In the prod designer, open the workflow by its id, replace the JSON with the paste file, save, and enable.
- **One at a time, about a minute apart:** the open lists start these workers every minute, so each new version's first run
  happens alone. Several first runs at once are what stuck them.
- **Rollback:** paste the `.base.json` back. That brings back the stuck id, so only do it if a paste breaks something else.

## After the pastes
- `python3 verify.py`: each enabled version must equal its paste, and its latest runs must be Complete. It also lists
  GD_COMPLETE_WORKER's runs: if a publish can stick a worker that runs at that moment, each paste could stick another one.
- The two LSH edits should then run on the next GD_EDIT_WORKER kick, and GD-2610-1897 / 1892 leave Processing.
- **Verified 04:06:** every enabled version equals its paste, and the latest runs of all six GD workers are Complete. Both
  LSH edits COMPLETED; GD-2610-1897 and 1892 are Created again.
- **Repo / dev parity:** a dev→prod promotion must not bring an old id back while prod still runs the JVM that stuck it.
  - **GD_EDIT_WORKER and GD_REVERT_WORKER, done 04:13:** the builders carry the new ids; dev v10 / v8 published with
    `wf_upload.dev.plan.json`. Repo = dev = prod (IDENTICAL).
  - **GD_ASYNC_WORKER, GD_PICKING_OUTBOX_CONSUMER and GD_CANCEL_WORKER:** the GD session's, carried by it.
- **Other V2 workers** (GR / Putaway / IA / SA / LOT / Packing / SO save) haven't run since the restarts. If one shows
  `is not loaded` when users start, the same rename fixes it.
