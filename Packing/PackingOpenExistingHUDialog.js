// Open the hu_dialog and populate table_select_hu with available
// handling_unit records from the DB, scoped to the current Packing's plant
// and organization, excluding HUs already present in table_hu.
//
// Paste into a new handler slot (e.g. "PackingOpenExistingHUDialog") and wire
// to a toolbar button "Select Existing HU" near table_hu.

(async () => {
  try {
    const data = this.getValues();
    const plantId = data.plant_id;
    const organizationId = data.organization_id;

    if (!plantId || !organizationId) {
      this.$message.warning(
        "Plant and organization must be set before selecting an HU.",
      );
      return;
    }

    // Exclude HUs already in this Packing's table_hu
    const tableHu = data.table_hu || [];
    const excludedIds = tableHu
      .map((r) => r.handling_unit_id)
      .filter(Boolean);

    // Query handling_unit: plant + org match, not deleted
    const res = await db
      .collection("handling_unit")
      .where({
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get();
    const allHUs = (res && res.data) || [];

    const available =
      excludedIds.length > 0
        ? allHUs.filter((hu) => !excludedIds.includes(hu.id))
        : allHUs;

    if (available.length === 0) {
      this.$message.warning(
        "No available handling units found for this plant/organization.",
      );
      return;
    }

    // Map HU records to table_select_hu row shape (column models match the form).
    const rows = available.map((hu) => ({
      hu_select: 0,
      handling_unit_id: hu.id,
      handling_no: hu.handling_no || "",
      hu_material_id: hu.hu_material_id || "",
      hu_type: hu.hu_type || "",
      hu_quantity: hu.hu_quantity || 0,
      hu_uom: hu.hu_uom || "",
      item_count: hu.item_count || 0,
      total_quantity: hu.total_quantity || 0,
      gross_weight: hu.gross_weight || 0,
      net_weight: hu.net_weight || 0,
      net_volume: hu.net_volume || 0,
      storage_location: hu.storage_location || "",
      location_id: hu.location_id || "",
      hu_status: hu.hu_status || "",
      remark: hu.remark || "",
      parent_hu_id: hu.parent_hu_id || "",
      packing_id: hu.packing_id || "",
      closed_by: hu.closed_by || "",
    }));

    await this.setData({
      "hu_dialog.table_select_hu": rows,
    });
    await this.openDialog("hu_dialog");
  } catch (error) {
    console.error("PackingOpenExistingHUDialog error:", error);
    this.$message.error(error.message || String(error));
  }
})();
