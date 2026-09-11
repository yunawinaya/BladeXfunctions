const getOrganizationId = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

// Each parent material carries its own V1, V2, V3... series, so the scan is
// scoped to the material and the org rather than using a global counter. The
// same rows answer "is this the material's first BOM?", so one fetch does both.
const scanMaterialBoms = async (materialId, organizationId) => {
  const res = await db
    .collection("bill_of_materials")
    .where({
      parent_material_code: materialId,
      organization_id: organizationId,
      is_deleted: 0,
    })
    .get();

  const records = res.data || [];

  const highest = records.reduce((max, record) => {
    const match = /^V(\d+)$/.exec(
      String(record.parent_mat_bom_version || "").trim()
    );
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);

  return {
    nextVersion: "V" + (highest + 1),
    isFirstBom: records.length === 0,
  };
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

    // fieldModel.item is not populated on this handler's payload, so the item is
    // read back by id rather than trusted from the event.
    let item = fieldModel?.item;
    if (!item || !item.material_name) {
      const res = await db
        .collection("item")
        .field("material_name,material_desc,item_category,based_uom")
        .where({ id: value })
        .get()
        .catch((error) => {
          console.error("Error fetching item:", error);
          return { data: [] };
        });
      item = (res.data || [])[0] || {};
    }

    await this.setData({
      parent_material_name: item.material_name || "",
      parent_material_desc: item.material_desc || "",
      parent_material_category: item.item_category || null,
      parent_mat_base_uom: item.based_uom || null,
      parent_mat_base_quantity: 1,
      parent_mat_is_default: 0,
      subform_sub_material: [],
    });

    const { nextVersion, isFirstBom } = await scanMaterialBoms(
      value,
      getOrganizationId()
    );

    // A material's first BOM has nothing to compete with, so it is the default
    // without the user having to tick it.
    this.setData({
      parent_mat_bom_version: nextVersion,
      parent_mat_is_default: isFirstBom ? 1 : 0,
    });
  } catch (error) {
    console.error("Error generating BOM version:", error);
    this.$message.error(error.message || "Failed to generate the BOM version");
  }
})();
