// UOM tab > inner tabs `vtr3oh28` onClick (slot 28q5gqlc).
//
// The two sub-tabs SHARE one UOM: switching carries the current pick across. When neither
// select has a value yet (i.e. the dialog was just opened), it defaults to the item's first
// ALTERNATE UOM, falling back to the base UOM only if the item has no alternates.
//
// NOTE the `balance_dialog.` prefix. `material_id` is a top-level field, but the UOM selects
// live INSIDE the dialog. A bare `balance_uom` just creates a phantom top-level field:
// getValue reads it back fine, but the real select never changes.
(async () => {
  //                        [ this tab's uom, its grid,               the other tab's uom ]
  const TABS = {
    tab_item_balance: ["balance_uom", "table_balance_uom", "batch_balance_uom"],
    tab_item_batch_balance: [
      "batch_balance_uom",
      "table_batch_balance_uom",
      "balance_uom",
    ],
  };
  const [uomModel, gridModel, otherModel] = TABS[arguments[0]?.key] || [];
  const materialId = this.getValue("material_id");
  if (!uomModel || !materialId) return;

  const uomField = `balance_dialog.${uomModel}`;
  const otherField = `balance_dialog.${otherModel}`;
  const LOG = "[UOM tab click]";

  try {
    // Give the newly-activated sub-tab time to mount. Without this, the first switch to a
    // sub-tab targets a select that does not exist yet, so refreshFieldOptionData is a no-op
    // and its UOM stays blank.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Shared selection: the other sub-tab's pick wins, then this tab's own, then a default.
    let uomRowId = this.getValue(otherField) || this.getValue(uomField);

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
      // The base UOM is the identity row (alt_uom_id === base_uom_id, base_qty 1). Prefer a
      // real alternate when the item has one; fall back to base when it doesn't.
      const isBase = (r) => r.alt_uom_id === r.base_uom_id;
      uomRowId = (rows.find((r) => !isBase(r)) || rows.find(isBase))?.id;
      console.log(LOG, "default uom row =", uomRowId);
    }

    if (uomRowId && uomRowId !== this.getValue(uomField)) {
      // Options are remote with auto_refresh: 0 and filtered by
      // Item_id.id in {{value:material_id}}, so load them BEFORE setting the value --
      // otherwise there is no matching option and the select renders blank.
      this.refreshFieldOptionData([uomField]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await this.setData({ [uomField]: uomRowId });
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    const grid = await this.getComponent(`balance_dialog.${gridModel}`);
    grid?.refreshChange();
  } catch (error) {
    console.error(LOG, "auto-fill/refresh failed", error);
  }
})();
