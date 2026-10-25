# GD Edit V2: edits of lines with custom fields go to review (502801), 2026-10-25

**Paste into: GD_EDIT_COMMIT (id 2110618866011787266).** Not GD_EDIT_SUBMIT, GD_EDIT_WORKER or GD_COMPLETE_*.

## What goes wrong

- The GD form sends a line's custom fields by name, e.g. `{"kamco_kg_pc": 2.01}`.
- The platform stores them by its definition ids, e.g. `{"2074066865204011010": 2.01}`.
- E2 (the GD lines step) writes the line, then compares a raw read-back by key, so the two never match. The step retries,
  then calls its own write "changed by someone else" and stops the edit for review. The delivery stays Processing.
- **Seen once:** GD2610-0654 (502801), 10-23 16:23. It was fixed by hand on 10-24 10:09 (the payload re-keyed by id, the job
  resumed).
- **Who is exposed:** tenants with GD line custom-field definitions. On prod that is 502801 only (4 kamco fields). LSH
  (128671) has none.

## The change

- E2's three line reads (`sql_node_GXe2la`, `sql_node_GXe2lb`, `sql_node_GXe2back`) also return one row with the line
  table's definitions (`su_code_custom_field`, GD table 1902054888473481218, line key `fwii8mvb`).
- E2's comparisons translate ids to names before comparing, as the platform does when it reads.
- The write is unchanged. The platform keeps valid definition ids it is given, so nothing is wiped (the 10-24 resume wrote
  ids and read them back intact).
- A tenant without definitions gets an empty map, so its behaviour is unchanged (checked for 128671 on prod).

## Files

| File | What it is |
|---|---|
| `GD_EDIT_COMMIT.json` | Paste this. Prod v11 plus the fix: 11 nodes differ (the three reads, and the 8 code nodes that include e2.js) |
| `GD_EDIT_COMMIT.prod_v11.json` | Prod's live v11 (2026-10-22 19:53:00), read 10-25; byte-identical to dev v11 |

## Evidence

- `scratchpad/gde/test/test_commit.js`: 56/56. The 6 new custom-field cases fail on v11 (3 of them), and mutants
  `e2_cf_raw` / `e2_cf_keep_undefined` are caught.
- `scratchpad/gde/test/replay_cf_0654.js`: the recorded prod reads of GD2610-0654.
  - With the fix, the check passes and the retry finds its write landed.
  - With v11, it ends in review exactly as on prod.
- The built read SQL ran read-only on prod (502801: definitions row, then the line; 128671: empty map) and on dev (239760).
- `scratchpad/gde/test/run_all.sh`: the same as the last full run. The parity / alloc / plan / cascade failures are older
  fixture drift and were there before.
- Lint: no new findings.
- Dev: published as v12 at 13:18:45 (the user's yes; backup v11_20261025-131549). Live smoke as admin@496474:
  GD/20261022/115 line 1 2 -> 1, job 2114225745830400001 COMPLETED in one worker call (7.5 s).
  - Snapshot diff showed only the expected writes: line + summary, reservation 2 -> 1 plus its split, SO planned 2 -> 1,
    Reserved -1 / Unrestricted +1, 2 movements.
  - E2's read-back returned the definitions row (`{}` for 496474) and passed.

## After the paste

**Pasted 2026-10-25 13:31:06 as prod v12: IDENTICAL** (checked by `wf --prod deployed`).

Check the target: `.dbtools/wf --prod deployed "Goods Delivery/EditV2/GD_EDIT_COMMIT.json"` must say IDENTICAL.
