# 2026-10-26 08:08 GD_BULK_COMMIT: a dead stock call is retried as the same operation

> **SUPERSEDED - do not paste.** Replaced by `../2026-10-26-gd-commit-oldest-first-v3/GD_BULK_COMMIT.json` (prod v28, 08:39),
> which contains this change. Pasting this folder would undo later fixes.

Was live on prod as GD_BULK_COMMIT v25 (08:09:25).

**Change:** in code_node_7NQFbpmU (after-call), a caught failed engine call on an unfinished operation (LOCKING / LOCKED, lease
expired, no mutation) is retried with the SAME operation id (`retrySame`), not `|attempt+1`. The next call reaches the engine's
RECOVER route (decideOnRepeat: pre-mutation + expired lease -> RECOVER, keys released, REJECTED) and the retry after that moves
to a new id. Before, a new id left the dead operation holding its keys for good: 81 key rows on 10-26, released by
`../2026-10-26-lsh-orphan-locks/repair.sql`.

Script: `scratchpad/gdc/gdcreate/patch_commit_same_op_retry.py`. Test: `scratchpad/gdc/gdcreate/test/test_commit_same_op.js`.
