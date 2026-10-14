# 2026-10-14 — GD form: hidden Picking dropdowns load every Picking

**Symptom.** Editing the GD form in the designer fails with `Query execution was interrupted,
maximum statement execution time exceeded`. The failing query reads `transfer_order` with both
Picking subforms joined.

**Cause.** In `table_gd`, the hidden column `line_to_id` ("Picking ID") is a select bound to
`Transfer Order Picking` with an empty filter. Its label is the plain field `to_id`. The platform's
`fetchData` adds a `.field()` projection only when a label is a dotted path. Without one, this
select reads every Picking field with records × items joined.

The designer loads the newest Pickings from all tenants this way. Prod has PI-20261013-1502
(LSH): 2,096 × 2,096 = 4.39M joined rows. Dev has two 2,000 × 2,000 test Pickings.

**Fix.** Three hidden Picking selects get the filter `id numberEqual 0`: `line_to_id`,
`to_record_id` and `picking_record_id` (in the Item Balance dialog).

- The filter is ANDed into every options load and every label lookup, so each now returns no rows.
- The stored value is kept. When a label lookup returns nothing, `_coerceDataModelType()` exits
  early and leaves the value as it was.
- The schema is unchanged: bigint column, FK to `transfer_order.id`. No DDL runs.

**File.** `goods_delivery.prod.v669.json` is deployed prod v669 with only those three filter
leaves changed (21 keys). Paste it only after the dev paste has passed its checks.
