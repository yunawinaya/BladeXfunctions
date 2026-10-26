# Sales Invoice: header custom fields carried from SO / GD (2026-10-27)

**Ask (LSH, tenant 128671):** the SO header custom fields (Envelope, Restday, RestHour, ReceiveHour) must reach the GD and
the SI, the way PO → GR → PI already carry theirs. This folder is the SI half; the GD half is
`prod-hotfix/2026-10-27-sales-header-cf-gd/`. The two halves can be pasted in either order.

**Today on prod the SI does not store its header custom fields at all.** SI_SAVE's Add / Update nodes have fixed prop lists
without `custom_fields_h35azf2l`, so a value typed in the SI form is dropped on save (0 of LSH's 561 SIs hold one).

**What changes**

- **SI_SAVE:** Add Data writes `custom_fields_h35azf2l`. Update Data writes it through a keep-stored guard: a save whose
  payload leaves the key out reads the stored value **by field name** and writes that back. It never writes the raw
  stored ids, because the platform drops an id-keyed header write (GD/20261027/632 on dev, 10-27).
- **GD_Convert_SI / SO_Convert_SI:** the header SQL also returns the source's header custom fields by field name, and the
  header map copies them to the SI. A combined SI takes the first document's, like its addresses and remarks.
- **SO_SAVE:** an auto-SI (an Issued SO with auto SI on) takes the SO's.
- **SI form:**
  - `onChange_soID` (after "Add from SO / GD") fills a **new** SI's header custom fields from the first GD, else the
    first SO, only while the box is still empty.
  - The box is laid out like the SO's: 2 fields per row, its own "Custom Fields" label hidden (was 3 per row).
- The copy is by field name: a value shows on the SI when the SI has a field of the same name. LSH has all four on SO,
  GD and SI on prod (created 10-26 20:56-21:01). The SI copies what the source holds at that moment; later SO / GD edits
  do not flow down.

**Dev** (published 2026-10-27 with the user's yes; backups in `~/Documents/ASC-dev/workflow-backups/dev/`):
- SI_SAVE v88, SO_Convert_SI v59, GD_Convert_SI v31, SO_SAVE v173, SI form v396.
- `python3 scratchpad/salescf/deploy/verify_dev.py` says ALL LIVE AS BUILT.
- Live: SO → SI made SI/20261027/0169, which stored the SI's own definition ids and reads back by name.

**Prod build:**
- Builder: `python3 scratchpad/salescf/build.py --env prod`.
- Tests in `scratchpad/salescf/test/` passed on the prod builds:
  - test_si_save 7;
  - test_si_fill --prod (gd / so / so_save);
  - test_si_form 8;
  - test_cf_box_layout 2.
- Linter: no new findings.

## Paste (user), in this order

Every paste file is the prod version live now (the matching `*_base.json`, checked IDENTICAL to prod on 10-27) plus this
change only.

1. Workflow **SI_SAVE**, id **`2029040374929154050`**. Not SI_CANCEL, not SI_POST. File `1_SI_SAVE.prod_paste.json`.
2. Workflow **GD_Convert_SI**, id **`2070069049332416514`**. File `2_GD_Convert_SI.prod_paste.json`.
3. Workflow **SO_Convert_SI**, id **`2029006184569364481`**. File `3_SO_Convert_SI.prod_paste.json`.
4. Workflow **SO_SAVE**, id **`1988908545345945602`**: the classic one. Not SO_SAVE_COMMIT / _PREPARE / _RUN / _SUBMIT /
   _WORKER (SO V2), not SO_CASCADE. File `4_SO_SAVE.prod_paste.json`.
5. Form **Sales Invoice** (`sales_invoice`, id **`1902525285396496385`**). Not Sales Invoice Line, not Sales Invoice
   Print. File `5_SalesInvoice_form.prod_paste.json`.

**Check:** `python3 scratchpad/salescf/deploy/verify_prod.py si`. Every line must say PASTED. It compares by workflow / form
id, so a look-alike name cannot fool it. Then `python3 scratchpad/prod_health.py` a few minutes later.

**Restore:** paste the matching `*_base.json` back, in reverse order.

## Notes

- No data repair: existing SIs never stored header custom fields.
- The SO side needs nothing:
  - prod's SO form (v446) already has the box, laid out 2 per row with its label hidden;
  - both SO saves (classic SO_SAVE and V2 SO_SAVE_COMMIT) already write `custom_fields_m07krnod`.
  - LSH's SOs hold no values yet (0 of 5,301; none entered since the fields were created), so the carry starts with the
    SOs they fill from now on.
- Tenant 073522 has one SO header field (`kf_so_type`, 688 SOs) and no SI definitions. Nothing shows on its SIs. The
  platform keeps a field name as-is on a table where the tenant has no definitions, so the value may ride along unseen.
