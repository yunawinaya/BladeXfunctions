# Custom fields on Customer and Supplier

Customer and Supplier get a **Custom Fields** container under the header grid: two columns, label hidden, the same as
the PO / SO / PR header containers. A tenant admin then defines the fields in the Custom Fields settings page
(自定义字段), with target table Customer or Supplier. Values are stored as one JSON object per record, keyed by each
field's `field_name`.

| Table | New column (JSON) |
|---|---|
| `customer` | `custom_fields_5v598pdl` |
| `supplier_head` | `custom_fields_csihktvh` |

## Files

Prod runs exactly the dev bases these were built on: Customer form v238, Supplier form v193, CUSTOMER_SAVE v3 and
SUPPLIER_SAVE v3, compared by content on 2026-10-16. Each file equals what dev runs now.

| File | Paste into | Change |
|---|---|---|
| `Customer.form.prod.json` | Customer form | + `custom-fields` container `custom_fields_5v598pdl` (list[5], after `grid_k7teuzz1`) |
| `supplier_head.form.prod.json` | Supplier form | + `custom-fields` container `custom_fields_csihktvh` (list[5], after `grid_3qjlvhqz`) |
| `CUSTOMER_SAVE.prod.json` | CUSTOMER_SAVE | `add_customer` + `update_customer` map `custom_fields_5v598pdl` |
| `SUPPLIER_SAVE.prod.json` | SUPPLIER_SAVE | `add_supplier` + `update_supplier` map `custom_fields_csihktvh` |

## Paste order

1. **Both forms first.** Publishing the form creates the JSON column and turns on `has_custom_fields` for the table,
   which is what lists Customer / Supplier in the Custom Fields page. Both were verified on dev.
2. **Then CUSTOMER_SAVE and SUPPLIER_SAVE.** If they go first, they map a column that does not exist yet.

The Supplier form publish also makes the backend add `numberRule: "amount"` to `supplier_credit_limit` in the table
schema (its own re-derivation, it did the same on dev). The column type stays `decimal(65,2)`.

## Check after pasting

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = DATABASE() AND column_name IN ('custom_fields_5v598pdl', 'custom_fields_csihktvh');  -- 2 rows

SELECT table_name, has_custom_fields FROM su_code_tables
WHERE id IN (1902779099617804290, 1901541078662762497);  -- both 1
```

`.dbtools/wf --prod deployed "Customer/CustSaveWorkflow.json"` and `"Supplier/SupplierSaveWorkflow.json"` should then
both say IDENTICAL.

## Dev

Published 2026-10-16 10:35–10:36 MYT: Customer form v239 (the admin's unpublished draft of 10-14 with this container,
set to two columns with the label hidden), Supplier form v194, CUSTOMER_SAVE v4, SUPPLIER_SAVE v4. Backups are in
`~/Documents/ASC-dev/workflow-backups/dev/`. Tested on dev through the browser's gateway. Add stored
`{"cf_test":"hello","cf_num":12}`, and Edit replaced it with `{"cf_test":"edited","cf_num":34}`. Test records left in
tenant 000000: customer CFTEST1016 "CF TEST CUSTOMER 20261016" and supplier SUP-0012 "CF TEST SUPPLIER 20261016".

The repo's CUSTOMER_SAVE and SUPPLIER_SAVE come from `scratchpad/gen_cust_supplier_save_workflows.py`. The new
columns were appended to `scratchpad/customer_save_columns.json` and `supplier_save_columns.json`.
