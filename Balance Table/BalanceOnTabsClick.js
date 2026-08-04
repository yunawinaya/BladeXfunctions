// Balance dialog > outer tabs `yogxd3d4` onClick (slot e6cezmjf).
// Replaces the existing handler: same behaviour for the four collection-backed tabs, plus
// tab_o265y1zp (UOM), which was missing entirely -- so entering the UOM tab did nothing.
// For UOM it seeds the default inner tab ("Item Balance") the same way the inner-tab
// handler (28q5gqlc) does, since that one only fires on an inner tab click.
//
// NOTE the `balance_dialog.` prefix on the UOM field. `material_id` is top-level, but the UOM
// selects live INSIDE the dialog. A bare `balance_uom` just creates a phantom top-level field:
// getValue reads it back fine, but the real select never changes.
(async () => {
  const tabMap = {
    tab_1: "custom_9xise27n",
    tab_9rrjdye5: "custom_3o6ysnz3",
    tab_fa7ie4dc: "custom_54oylxq1",
    tab_ve8pk29t: "custom_razt1pqa",
  };
  const key = arguments[0]?.key;
  const UOM_FIELD = "balance_dialog.balance_uom";
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

    if (!this.getValue(UOM_FIELD)) {
      const res = await db
        .collection("Item_mji552rc_sub")
        .where({ Item_id: materialId, is_deleted: 0 })
        .get();
      const baseRow = (res?.data || []).find(
        (r) => r.alt_uom_id === r.base_uom_id
      );
      console.log(LOG, "identity row =", baseRow?.id, typeof baseRow?.id);

      if (baseRow) {
        // Options are remote with auto_refresh: 0 and filtered by
        // Item_id.id in {{value:material_id}}, so load them BEFORE setting the value --
        // otherwise there is no matching option and the select renders blank.
        this.refreshFieldOptionData([UOM_FIELD]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await this.setData({ [UOM_FIELD]: baseRow.id });
        console.log(LOG, `${UOM_FIELD} =`, this.getValue(UOM_FIELD));
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    const uomGrid = await this.getComponent("balance_dialog.table_balance_uom");
    uomGrid?.refreshChange();
  } catch (error) {
    console.error(LOG, "refresh failed", error);
  }
})();
