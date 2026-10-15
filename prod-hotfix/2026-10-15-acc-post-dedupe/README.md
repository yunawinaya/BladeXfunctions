# BUG-20261013-019: a document can be queued for accounting posting twice

ACC_PRODUCER inserted every `post_*` request as a new PENDING task. The Stock Adjustment form and list
pre-write `posted_status = "Pending Post"` and call it. The list skips rows only by its own stale copy of that
status. On 2026-10-12 a second click 10.5 s later queued AJ-001/002 again while the first task was PROCESSING.
The agent works one task at a time and posted both: SQL docKey 722, stock card 4 to 0 to -4.

## Fix (ACC_PRODUCER, `post_*` requests only)

`sync_*`, `free_query` and the recovery branch are untouched. Every `post_*` payload is a JSON array of ids.

1. `code_node_PostGuardIds` reads the ids.
2. In parallel:
   - `search_node_PostInflight`: tasks of the same agent and task_type that are PENDING or PROCESSING.
   - `search_node_PostAjPosted`: for `post_aj`, Stock Adjustments already `Fully Posted`. Only the success
     callback sets that status, and no client overwrites it.
3. `code_node_PostGuardDecide` drops an id held by a PROCESSING task, or by a PENDING task still in the agent's
   Redis queue. A PENDING task that fell out of the queue is never polled, so it holds nothing. It also drops
   Fully Posted ids.
4. Fully Posted ids get `posted_status` set back to `Posted`, undoing the client's "Pending Post" pre-write.
5. If nothing is left, it returns `skipped` and queues no task. Otherwise the new branch
   `11. POST DOCUMENT` queues only the remaining ids. Its add node is a copy of the default "Add Tasks"; only
   the payload differs.

Replay over prod `post_*` tasks since 2026-08-15: 7,574 tasks, 25 would have been refused, and all 25 really
ran to COMPLETED. That is 18 Ascent `post_gd` (one GD queued 10+ times on 09-07 while the agent was offline),
3 `post_grn`, 3 `post_cs` and this `post_aj`. No retry after a FAILED task is refused.

## Not covered

- Two submits less than a second apart can both pass the check. There is no atomic primitive in this path.
- Reposting another document type after it COMPLETED, from a stale screen. Only `post_aj` has the
  "already posted" check, for example the 2026-10-14 Ascent GD batch posted twice 96 s apart. Each type would
  need its own posted-status lookup.

## Files

- `ACC_PRODUCER.prod.json`: prod enabled v68 plus the guard. **Paste into prod.**
- `ACC_PRODUCER.dev.json`: dev enabled v119 (which has the dev-only Sync Quotation branch) plus the same guard.
- `build.py`: refetches both enabled versions and re-applies the patch, asserting on the baseline.
