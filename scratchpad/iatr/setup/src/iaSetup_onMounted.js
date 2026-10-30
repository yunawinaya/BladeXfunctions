// Item Assembly Setup (Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md D12) - mounted: the login's organisation
// and its setup row. Every plant row of an organisation carries the same values (as Picking Setup's do); no row = off.
(async () => {
  try {
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }
    await this.setData({ organization_id: organizationId });
    const res = await db.collection("item_assembly_setup").where({ organization_id: organizationId }).get();
    const row = res && Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;
    this.setData({
      item_assembly_setup_id: row ? row.id : "",
      transfer_request_enabled: row && Number(row.transfer_request_enabled) === 1 ? 1 : 0,
    });
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "The Item Assembly Setup could not be read");
  }
})();
