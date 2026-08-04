// Balance dialog > outer tabs `yogxd3d4` onClick (slot e6cezmjf).
// Replaces the existing handler: same behaviour for the four collection-backed tabs, plus
// tab_o265y1zp (UOM), which was missing entirely -- so entering the UOM tab did nothing.
// For UOM it seeds the default inner tab ("Item Balance") the same way the inner-tab
// handler (28q5gqlc) does, since that one only fires on an inner tab click.
//
// NOTE the `balance_dialog.` prefix. `material_id` is top-level, but the UOM selects live
// INSIDE the dialog. A bare `balance_uom` just creates a phantom top-level field.
(async () => {
  const tabMap = {
    tab_1: "custom_9xise27n",
    tab_9rrjdye5: "custom_3o6ysnz3",
    tab_fa7ie4dc: "custom_54oylxq1",
    tab_ve8pk29t: "custom_razt1pqa",
  };
  const key = arguments[0]?.key;
  const UOM_FIELD = "balance_dialog.balance_uom";
  const OTHER_FIELD = "balance_dialog.batch_balance_uom";
  const LOG = "[tabs click]";

  try {
    if (key !== "tab_o265y1zp") {
      const crud = await this.getComponent(`balance_dialog.${tabMap[key]}`);
      crud?.refreshChange();
      return;
    }

    const materialId = this.getValue("material_id");
    if (!materialId) return;

    // Give the tab's contents a beat to mount before touching the select.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Shared selection: the batch sub-tab's pick wins, then this one's own, then a default.
    let uomRowId = this.getValue(OTHER_FIELD) || this.getValue(UOM_FIELD);

    if (!uomRowId) {
      const res = await db
        .collection("Item_mji552rc_sub")
        .where({ Item_id: materialId, is_deleted: 0 })
        .get();
      // Sort by id: the fetch has no ORDER BY, and ids are same-length snowflakes so string
      // order == creation order. Row 0 is always the base identity row, row 1 the first alt.
      const rows = (res?.data || [])
        .slice()
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      // Prefer a real alternate UOM; the identity row (alt_uom_id === base_uom_id) is base.
      const isBase = (r) => r.alt_uom_id === r.base_uom_id;
      uomRowId = (rows.find((r) => !isBase(r)) || rows.find(isBase))?.id;
      console.log(LOG, "default uom row =", uomRowId);
    }

    if (uomRowId && uomRowId !== this.getValue(UOM_FIELD)) {
      // Remote select with auto_refresh: 0 -- load options for this material_id BEFORE
      // setting the value, or the select renders blank.
      this.refreshFieldOptionData([UOM_FIELD]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await this.setData({ [UOM_FIELD]: uomRowId });
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    const uomGrid = await this.getComponent("balance_dialog.table_balance_uom");
    uomGrid?.refreshChange();
  } catch (error) {
    console.error(LOG, "refresh failed", error);
  }
})();
