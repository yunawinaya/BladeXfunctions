# 2026-10-26 08:40 GD_BULK_COMMIT: oldest-first, now actually reaching the decision

Replaces `../2026-10-26-gd-commit-oldest-first-v2/` (prod v27, 08:21). One change: `older_waiting` is declared in
sql_node_kY5OLfvj's `response_json`.

**Why it never fired.** The platform drops any SQL-node output column that is not declared in the node's response_json, the
same contract as code-nodes. The check's SQL was right, but its result never reached the decision code, so zero GDs ever
stepped aside on prod v26 / v27.

**How it was proven this time, on the platform:**
- A dev probe showed even a joined COUNT(*) disappears from the output when undeclared.
- With `older_waiting` declared and forced to a constant on dev, the GD stepped aside: COMMITTING_GD, attempt 0, "waiting
  (older delivery PROBE-OLDER waits for the same stock and goes first)", next try +30 s.
- With the real check (dev v30), the same job then completed: GD/20261026/623.

Paste into **GD_BULK_COMMIT (2104840402446245890)**.
