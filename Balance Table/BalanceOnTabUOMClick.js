// UOM tab > inner tabs `vtr3oh28` onClick (slot 28q5gqlc).
// Auto-fills the tab's UOM select with the item's base UOM (only when blank), then refreshes
// that tab's grid.
//
// NOTE the `balance_dialog.` prefix on the UOM field. `material_id` is a top-level field, but
// the UOM selects live INSIDE the dialog -- same reason getComponent needs the prefix. Setting
// a bare `balance_uom` just creates a phantom top-level field: getValue reads it back fine,
// but the real select never changes. Precedent: SOfullJSON `dialog_price_history.item_id`.
(async () => {
  const TABS = {
    tab_item_balance: ["balance_uom", "table_balance_uom"],
    tab_item_batch_balance: ["batch_balance_uom", "table_batch_balance_uom"],
  };
  const [uomModel, gridModel] = TABS[arguments[0]?.key] || [];
  const materialId = this.getValue("material_id");
  if (!uomModel || !materialId) return;

  const uomField = `balance_dialog.${uomModel}`;
  const LOG = "[UOM tab click]";

  try {
    if (!this.getValue(uomField)) {
      // The select's value is an Item_mji552rc_sub ROW id, not a UOM id. The base UOM's row
      // is the identity row -- the one where alt_uom_id === base_uom_id.
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
        this.refreshFieldOptionData([uomField]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await this.setData({ [uomField]: baseRow.id });
        console.log(LOG, `${uomField} =`, this.getValue(uomField));
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    const grid = await this.getComponent(`balance_dialog.${gridModel}`);
    grid?.refreshChange();
  } catch (error) {
    console.error(LOG, "auto-fill/refresh failed", error);
  }
})();
