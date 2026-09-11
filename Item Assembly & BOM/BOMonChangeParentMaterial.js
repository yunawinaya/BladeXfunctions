const getOrganizationId = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

// Each parent material carries its own V1, V2, V3... series, so the scan is
// scoped to the material and the org rather than using a global counter.
const computeNextVersion = async (materialId, organizationId) => {
  const res = await db
    .collection("bill_of_materials")
    .where({
      parent_material_code: materialId,
      organization_id: organizationId,
      is_deleted: 0,
    })
    .get();

  const highest = (res.data || []).reduce((max, record) => {
    const match = /^V(\d+)$/.exec(
      String(record.parent_mat_bom_version || "").trim()
    );
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);

  return "V" + (highest + 1);
};

(async () => {
  try {
    const { value, fieldModel } = arguments[0];

    if (!value) {
      this.setData({
        parent_material_name: "",
        parent_material_desc: "",
        parent_material_category: null,
        parent_mat_base_uom: null,
        parent_mat_bom_version: "",
        parent_mat_is_default: 0,
        parent_mat_base_quantity: 0,
        subform_sub_material: [],
      });
      return;
    }

    const item = fieldModel?.item || {};

    await this.setData({
      parent_material_name: item.material_name,
      parent_material_desc: item.material_desc,
      parent_material_category: item.item_category,
      parent_mat_base_uom: item.based_uom,
      parent_mat_base_quantity: 1,
      parent_mat_is_default: 0,
      subform_sub_material: [],
    });

    // -9999 is the Manual Input rule: the user types the version themselves.
    if (this.getValue("parent_mat_bom_version_type") === -9999) return;

    this.setData({
      parent_mat_bom_version: await computeNextVersion(
        value,
        getOrganizationId()
      ),
    });
  } catch (error) {
    console.error("Error generating BOM version:", error);
    this.$message.error(error.message || "Failed to generate the BOM version");
  }
})();
