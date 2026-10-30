// Item Assembly Setup (Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md D12) - Save: the same values on one row per
// plant of the organisation (an organisation without plants: one row whose plant is the organisation), as Picking Setup keeps them;
// readers take the organisation's first row.
const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    const data = this.getValues();
    const organizationId = String(data.organization_id || "");
    if (!organizationId) {
      this.$message.error("No organisation found for this login.");
      return;
    }
    const entry = { organization_id: organizationId, transfer_request_enabled: Number(data.transfer_request_enabled) === 1 ? 1 : 0 };
    const plants = await db
      .collection("blade_dept")
      .where({ parent_id: organizationId })
      .get()
      .then((res) => (res.data || []).map((item) => item.id));
    const targets = plants.length > 0 ? plants : [organizationId];
    const existing = (await db.collection("item_assembly_setup").where({ organization_id: organizationId }).get()).data || [];
    for (const plant of targets) {
      const row = existing.find((r) => String(r.plant_id) === String(plant));
      if (row) await db.collection("item_assembly_setup").doc(row.id).update(entry);
      else await db.collection("item_assembly_setup").add(Object.assign({}, entry, { plant_id: plant }));
    }
    // a row of a plant no longer in the organisation keeps the same values, so every reader agrees
    for (const row of existing) {
      if (!targets.some((p) => String(p) === String(row.plant_id))) await db.collection("item_assembly_setup").doc(row.id).update(entry);
    }
    closeDialog();
    this.$message.success("Update Successfully");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
