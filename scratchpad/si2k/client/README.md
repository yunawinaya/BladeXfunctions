# SI form at 2,000 lines (client side)

Built on live dev: Sales Invoice form v387 (`base_SI_form.v387.json`), Goods Delivery list page v399
(`base_GoodsDelivery_page.v399.json`). The repo `Sales Invoice/SIfullJSON.json` is behind v387 (cash-sales filter in Batch Add,
Fully Posted in mounted, a precision change), so it is not the base.

| Handler | Problem at 2,000 lines | Change |
|---|---|---|
| `SIcalculation` (e063qm85) | flat bundle children found by scanning every row per row; ~10,000 row writes per call; 3 logs per row | child index built once; only changed line values written; no per-row logs; new `{ rows: [...] }` payload = one call per listed row, in order, each row current |
| `onRowRemove_item` (5vr8zl63) | awaits a full recalculation per remaining row (1,999 on a 2,000-line invoice) | one `{ rows }` call |
| `onChange_taxInclusive` (um2s81kb, rule) | AutoCount orgs: a full recalculation per row + one | one `{ rows }` call |
| `onConfirm_batchAddItem` (ua6gcgje) | one order-line read per delivery line; a full recalculation per line; two UI calls per line | order lines 500 per read; one `{ rows }` call; one `disabled` call per state; a bundle's document read once |
| GD list `func_convertSI` (5i0cg4mt) | reads every selected delivery whole (2,000 lines) to get `so_id` | `.field("so_id")` / `.field("so_type")` on the two pre-check reads |

`{ rows }` reproduces what the per-row calls left: the last call's line values and totals, plus what each earlier call wrote onto a
row's own inputs (the current row's unit price, a discount cleared or given its "Amount" unit).

- `python3 build_form.py` -> `out_SI_form.json`, `out_GoodsDelivery_page.json`, `out_js/` (bodies for the repo mirrors:
  `SIbatchAddLineItem.js`, `handleConvertGDtoSI.js`; `SIcalculation.js` in the repo is an unrelated old version; the row-remove and
  tax-inclusive handlers have no repo .js)
- `node client_test.js [--quick]` old vs new in a mock form, under both possible column-onChange payloads and with/without fm_keys
- `node page_test.js` the GD list pre-check old vs new
