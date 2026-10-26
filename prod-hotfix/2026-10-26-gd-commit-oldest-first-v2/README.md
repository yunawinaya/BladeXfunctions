# 2026-10-26 08:21 GD_BULK_COMMIT: oldest-first, corrected

> **SUPERSEDED - do not paste.** Replaced by `../2026-10-26-gd-commit-oldest-first-v3/GD_BULK_COMMIT.json` (prod v28, 08:39), which contains this change. Pasting this folder would undo later fixes.


Replaces `../2026-10-26-gd-commit-oldest-first/` (prod v26 at 08:14). One change in `sql_node_kY5OLfvj`:
an older job counts as waiting while its `P3_INVENTORY_APPLY` step row is STARTED (stock step unfinished), instead of by its
retry `error_code`.

Why: the error code changes for a moment during each try. The oldest waiter (GD-2610-1479) is tried every few seconds, so a
new GD checking inside one of those tries saw no waiter. GD-2610-1571 slipped in at 08:16:48 and took one of its keys.

Tested: the SQL ran read-only on prod. GD-2610-1571 gets GD-2610-1479, 1470 gets 1479, and 1479 (the oldest) gets nothing;
0.4 s each. fifo / same-op / retry tests pass; lint unchanged (16). Dev v27 published, V2 smoke completed.

Paste into **GD_BULK_COMMIT (2104840402446245890)**.
