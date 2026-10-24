# PO line arrival date left blank (LSH-OPS-09), 2026-10-24

PO_SAVE v45 (live on dev and prod since 10-19) copies the PO header's `po_expected_date` to a line only when the line's
date is missing. The PO form sends an empty one (`''`), so lines saved without their own date got NULL. Prod at 12:40:
LSH 90 lines on 46 POs; 237197 2 lines; 528521 1 line.

## Production steps

1. Paste `PO_SAVE.json` into PO_SAVE (id 2069257894280118274) and enable it. Its base is prod v45 (`PO_SAVE.prod_v45.json`,
   identical to live at 12:34), with one change in `code_fillback`: `poLineItem.po_expected_date ?? entry.po_expected_date`
   becomes `||`.
2. Run `backfill.sql`: previews, then the LSH update (expect 90 rows). Step 3, the other two tenants (3 rows), is
   optional.

## Evidence

- `node test_fillback.js <file>` runs the file's `code_fillback` offline. The base fails the `''` line and the patch passes
  all four cases (`''`, null, missing, own date).
- Lint (`scratchpad/validate.py`): same findings as the base.
- Dev: published as v46 at 12:35 (`wf_upload.dev.plan.json`; backup v45_20261024-123455). Smoke `smoke/request.json`, run as
  admin@496474, created DRAFT-PO-0039: a blank line date received the header date 2026-10-30.
- The line date is written only through the PO line subform (`add_po` / `update_po` from `code_fillback`), so no other
  table needs a backfill.
