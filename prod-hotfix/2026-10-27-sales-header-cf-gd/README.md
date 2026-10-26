# Goods Delivery: header custom fields carried from SO (2026-10-27)

**Ask (LSH, tenant 128671):** the SO header custom fields (Envelope, Restday, RestHour, ReceiveHour) must reach the GD and
the SI. This folder is the GD half; the SI half is `prod-hotfix/2026-10-27-sales-header-cf-si/`.

**Today on prod the GD does not store its header custom fields at all.** No GD save writes the form's value into the
column, so a value typed in the GD form is dropped (0 of LSH's 652 GDs hold one).

**Prerequisite, met:** GD_EDIT_COMMIT v14 (GD Edit & Picking V2's E6 fix) has been live on prod since 10-27 02:22. Without
it a GD Edit V2 edit would wipe stored header custom fields. Re-check right before the paste:
`.dbtools/wf --prod deployed "Goods Delivery/EditV2/GD_EDIT_COMMIT.json"` must say GD_EDIT_COMMIT (id
2110618866011787266), IDENTICAL.

**Done, separate paste:** GD Edit V2 saves a header custom-field change. GD Edit & Picking V2 pasted
`prod-hotfix/2026-10-27-gde-header-cf-edit/` to prod on 10-27: GD_EDIT_PREPARE v11 (02:45:57) and GD_EDIT_SUBMIT v14
(02:47:04), both IDENTICAL. No GD Edit V2 run on prod has edited a header custom field yet; the first LSH header edit
after this folder's paste is the live check.

**Also in item 1: the GD session's tenant fix.** Item 1 is ONE file holding both changes, so GOODS_DELIVERY is pasted
once. It equals dev v252 exactly.
- What their fix does: `sql_node_GdSoGuard` / `sql_node_GdUomGuard` (the GD Created V2 guards) now read only the session
  tenant's GD / item / unit / job rows. Before, they read by id only, and the busy-job check fell back to `1 = 1`.
- Their separate `prod-hotfix/2026-10-27-gd-guard-tenant/GOODS_DELIVERY.json` is the same file, so do not paste it as
  well.
- If prod's GOODS_DELIVERY is no longer v182 when you paste, `verify_prod.py gd` shows DIFFERS for item 1. Stop: it must
  be rebuilt on the new prod version (this project's patch plus the GD session's
  `python3 scratchpad/gdc/gdcreate/patch_gd_guard_tenant.py`).

**What changes**

1. **GOODS_DELIVERY** (the classic GD save):
   - both Add nodes write `custom_fields`;
   - the three header Update nodes write it through a keep-stored guard. A save whose payload leaves the key out (a
     Picking / Packing re-save) reads the stored value **by field name** and writes that back. It never writes the raw
     stored ids, because the platform drops an id-keyed header write.
2. **GD_BULK_PREPARE / GD_BULK_COMMIT** (GD Created V2): `custom_fields` joins the header fields the chain copies
   (GDC.header_fields), and the header insert writes it.
3. **GD_COMPLETE_SUBMIT** (GD Complete V2): the GD Completed & Created V2 session's dev v15, which has this project's
   change ported into their sources, plus their line compare fix.
   - A form completion whose header custom fields were edited but not saved is sent to the classic save, which stores the
     edit.
   - Only `sql_node_GShdr` and `code_node_GSgate` differ from prod v12.
4. **SO_AUTO_GD** (SO list convert with auto-create, classic and V2 routes): the GD header takes the first SO's.
5. **SO_Convert_GD** (SO list Draft convert / form convert): each mapped GD takes its first SO's.
6. **GD form:**
   - both V2 save handlers send `custom_fields` in the header;
   - `onChange_soID` fills a **new** GD's header custom fields from its first SO, only while the box is still empty;
   - the box is laid out like the SO's: 2 fields per row, its own "Custom Fields" label hidden (was 3 per row with the
     label).

The copy is by field name: a value shows on the GD when the GD has a field of the same name. LSH has all four on SO, GD and
SI on prod. A GD made from several SOs takes the first SO's.

**Dev** (published 2026-10-27 with the user's yes; backups in `~/Documents/ASC-dev/workflow-backups/dev/`):
- Versions: GOODS_DELIVERY v251, GD_BULK_PREPARE v22, GD_BULK_COMMIT v33, GD_COMPLETE_SUBMIT v15 (GD session's),
  SO_AUTO_GD v22, SO_Convert_GD v58, GD form v1494. `python3 scratchpad/salescf/deploy/verify_dev.py` says ALL LIVE AS
  BUILT.
- Live on 000000:
  - SO_AUTO_GD classic made GD/20261027/632 and 633;
  - the V2 route made GD/20261027/634 (100 lines), later cancelled;
  - each stored the GD's own definition ids and reads back by name;
  - a form completion with an edited header custom field went classic as intended.

**Prod build:**
- Builder: `python3 scratchpad/salescf/build.py --env prod`. Item 4 is copied from dev v15.
- Tests passed on the prod builds:
  - test_gd_classic 7;
  - test_gd_v2_header 2;
  - test_v2_payload 3;
  - test_so_convert_gd 2;
  - test_gd_form 6;
  - test_cf_box_layout 2.
- Linter: no new findings (the same counts as prod's own versions).

## PROD DEPLOYED 2026-10-27 03:02-03:13 (user), verified

GD form v679, SO_Convert_GD v36, SO_AUTO_GD v22, GD_COMPLETE_SUBMIT v13, GD_BULK_COMMIT v31, GD_BULK_PREPARE v22 and
GOODS_DELIVERY v183 are each IDENTICAL to their paste file (`verify_prod.py gd`).
- GOODS_DELIVERY v183 is the combined item 1, re-issued about 03:10 before the paste: the CfOut guards declare `cf` as
  `any`, and it carries the GD session's tenant fix.
- prod_health showed only the CHECKs that were already there.

## Paste (user), in this order

Every paste file is the prod version live now (the matching `*_base.json`, checked IDENTICAL to prod on 10-27) plus this
change only. Writers go first, then the completion check, then the producers. The order is not strict: the V2 chain copies
header fields through its own list, so a form pasted early only sends a key the server ignores until items 2-3 are in.

1. Workflow **GOODS_DELIVERY**, id **`2017151544868491265`** (the classic GD save; repo `GDheadWorkflow.json`).
   Not GD_UNUSED_FN_NEW. File `1_GOODS_DELIVERY.prod_paste.json`. It holds the header custom fields and the GD session's
   tenant fix; paste it once.
2. Workflow **GD_BULK_PREPARE**, id **`2104840044642754561`**. File `2_GD_BULK_PREPARE.prod_paste.json`.
3. Workflow **GD_BULK_COMMIT**, id **`2104840402446245890`**. File `3_GD_BULK_COMMIT.prod_paste.json`.
4. Workflow **GD_COMPLETE_SUBMIT**, id **`2110182609618337794`**. Not GD_COMPLETE_WORKER. File
   `4_GD_COMPLETE_SUBMIT.prod_paste.json`.
5. Workflow **SO_AUTO_GD**, id **`2076557490389835777`**. File `5_SO_AUTO_GD.prod_paste.json`.
6. Workflow **SO_Convert_GD**, id **`1985267806223810561`**. Not SO_AUTO_GD, not GD_SO_CONVERT_CHECK. File
   `6_SO_Convert_GD.prod_paste.json`.
7. Form **Goods Delivery** (`goods_delivery`, id **`1902054888473481218`**). Not Goods Delivery Line, not the print
   forms. File `7_GoodsDelivery_form.prod_paste.json`.

**Check:** `python3 scratchpad/salescf/deploy/verify_prod.py gd`. Every line must say PASTED. It compares by workflow / form
id; `wf --prod deployed` cannot place GD_COMPLETE_SUBMIT because its node ids are shared by the GD Complete V2 workflows.
Then `python3 scratchpad/prod_health.py` a few minutes later.

**Restore:** paste the matching `*_base.json` back, in reverse order.

## Notes

- No data repair: existing GDs never stored header custom fields.
- Tenant 073522 has one SO header field (`kf_so_type`, 688 SOs) and no GD definitions. Nothing shows on its GDs. The
  platform keeps a field name as-is on a table where the tenant has no definitions, so the value may ride along unseen.
  - GD Complete V2 compares header custom fields by name and keeps such keys on both sides, so a form completion still
    goes V2.
  - Not verified: whether the form's box sends an unseen key back. If it does not, those completions take the classic
    path, which still completes them.
