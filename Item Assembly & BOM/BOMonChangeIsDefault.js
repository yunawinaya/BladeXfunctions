(async () => {
  try {
    const allData = this.getValues();
    const materialId = allData.parent_material_code;
    const currentId = allData.id;

    this.setData({ default_dialog: {} });

    if (allData.parent_mat_is_default !== 1 || !materialId) return;

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const res = await db
      .collection("bill_of_materials")
      .where({
        parent_material_code: materialId,
        parent_mat_is_default: 1,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get();

    // Skip the record being edited, otherwise editing the current default
    // pops a dialog warning about itself.
    const previous = (res.data || []).find(
      (record) => String(record.id) !== String(currentId)
    );
    if (!previous) return;

    this.openDialog("default_dialog");
    this.setData({
      "default_dialog.bom_version": previous.parent_mat_bom_version,
      "default_dialog.bom_id": previous.id,
    });
  } catch (error) {
    console.error("Error checking the default BOM:", error);
    this.$message.error(error.message || "Failed to check the default BOM");
  }
})();
