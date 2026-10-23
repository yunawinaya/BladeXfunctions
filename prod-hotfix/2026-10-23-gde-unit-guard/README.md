# GD Edit V2: unit guard on a Draft saved as Created (2026-10-23)

Pairs with `prod-hotfix/2026-10-23-gd-unit-guard/` (GOODS_DELIVERY v246, fa). Paste both on the same day so the classic
save and GD Edit V2 refuse the same lines.

On the GD form, a stored Draft saved as Created goes through GD Edit V2, not GOODS_DELIVERY. GOODS_DELIVERY v246 refuses a stock
line whose unit (`gd_order_uom_id`, else `good_delivery_uom_id`) is neither its item's base unit nor a conversion with
`base_qty > 0`, with a 400. GD Edit V2 now runs the same two classic nodes (`code_node_GdUomGuard` / `code_node_GdUomCheck`,
lifted byte-identical from v246), with the same rule, the same 400 and the same text. An edit of an already Created GD is never
refused, as in classic.

Paste, in prod, then enable:

1. `GD_EDIT_PREPARE.json` → GD_EDIT_PREPARE (prod v8)
2. `GD_EDIT_SUBMIT.json` → GD_EDIT_SUBMIT (prod v11)

Rollback: `GD_EDIT_SUBMIT.prod_v11.json` / `GD_EDIT_PREPARE.prod_v8.json` (prod's current versions, identical to dev's
before this change). GD_EDIT_COMMIT and GD_EDIT_WORKER are unchanged.

Checked on dev (SUBMIT v12, PREPARE v9): Draft/GD/0010 saved as Created with Item-008 in BAG → 400 with the classic text,
no job made; a normal edit of GD/20261022/115 (3 → 2) → COMPLETED with the expected writes.
