const showStatusHTML = (status) => {
  if (status === 1) {
    this.display(["active_status"]);
  } else {
    this.display(["inactive_status"]);
  }
};

const getOrganizationId = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

const HEADER_FIELDS = [
  "is_active",
  "parent_material_code",
  "parent_material_name",
  "parent_material_desc",
  "parent_material_category",
  "parent_mat_is_default",
  "parent_mat_bom_version",
  "parent_mat_base_quantity",
  "parent_mat_base_uom",
  "bom_remark",
];

const SUBFORM_COLUMNS = [
  "bom_material_code",
  "bom_type",
  "consume_type",
  "ref_bom_id",
  "sub_material_name",
  "sub_material_desc",
  "sub_material_category",
  "process_category",
  "sub_material_qty",
  "sub_material_qty_uom",
  "sub_material_wastage",
  "sub_material_remark",
];

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

// ref_bom_id stores a raw BOM id, so without its options the select renders a
// bare snowflake. Rehydrate one row at a time against the sub-material's BOMs.
const loadRefBomOptions = async (rowIndex, subMaterialId, organizationId) => {
  if (!subMaterialId) return;

  const res = await db
    .collection("bill_of_materials")
    .where({
      parent_material_code: subMaterialId,
      organization_id: organizationId,
      is_deleted: 0,
      is_active: 1,
    })
    .get();

  this.setOptionData(
    `subform_sub_material.${rowIndex}.ref_bom_id`,
    (res.data || []).map((record) => ({
      id: record.id,
      parent_mat_bom_version: record.parent_mat_bom_version,
      value: record.id,
      label: record.parent_mat_bom_version,
    }))
  );
};

const applyViewMode = () => {
  this.disabled(
    HEADER_FIELDS.concat(
      ["subform_sub_material"],
      SUBFORM_COLUMNS.map((column) => `subform_sub_material.${column}`)
    ),
    true
  );
  this.hide(["button_save", "button_cancel"]);
};

(async () => {
  try {
    let pageStatus = "";

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page status");

    const organizationId = getOrganizationId();
    this.setData({ page_status: pageStatus, organization_id: organizationId });

    if (pageStatus === "Add") {
      this.setData({ is_active: 1 });
      showStatusHTML(1);
      return;
    }

    const bomId = this.getValue("id");
    if (!bomId) {
      throw new Error("Bill of Materials ID not found");
    }

    const bomResponse = await db
      .collection("bill_of_materials")
      .where({ id: bomId })
      .get();

    if (!bomResponse.data || bomResponse.data.length === 0) {
      throw new Error(`Bill of Materials with ID ${bomId} not found`);
    }

    const bomData = bomResponse.data[0];
    const subMaterials = bomData.subform_sub_material || [];

    if (pageStatus === "Clone") {
      // A clone is the next version of the same material, so it must not carry
      // the source's row ids - reusing them would rewrite the source's children.
      const clonedRows = subMaterials.map((row) => {
        const { id, bill_of_materials_id, ...rest } = row;
        return rest;
      });

      await this.setData({
        id: null,
        is_active: bomData.is_active,
        parent_material_code: bomData.parent_material_code,
        parent_material_name: bomData.parent_material_name,
        parent_material_desc: bomData.parent_material_desc,
        parent_material_category: bomData.parent_material_category,
        parent_mat_base_quantity: bomData.parent_mat_base_quantity,
        parent_mat_base_uom: bomData.parent_mat_base_uom,
        parent_mat_is_default: 0,
        bom_remark: bomData.bom_remark,
        subform_sub_material: clonedRows,
      });

      this.setData({
        parent_mat_bom_version: await computeNextVersion(
          bomData.parent_material_code,
          organizationId
        ),
      });
    } else {
      await this.setData({
        id: bomData.id,
        is_active: bomData.is_active,
        parent_material_code: bomData.parent_material_code,
        parent_material_name: bomData.parent_material_name,
        parent_material_desc: bomData.parent_material_desc,
        parent_material_category: bomData.parent_material_category,
        parent_mat_base_quantity: bomData.parent_mat_base_quantity,
        parent_mat_base_uom: bomData.parent_mat_base_uom,
        parent_mat_bom_version: bomData.parent_mat_bom_version,
        parent_mat_is_default: bomData.parent_mat_is_default,
        bom_remark: bomData.bom_remark,
        subform_sub_material: subMaterials,
      });
    }

    showStatusHTML(bomData.is_active);
    this.disabled(["parent_material_code"], true);

    const rows = this.getValue("subform_sub_material") || [];
    await Promise.all(
      rows.map(async (row, rowIndex) => {
        await loadRefBomOptions(
          rowIndex,
          row.bom_material_code,
          organizationId
        );
        this.disabled(
          [`subform_sub_material.${rowIndex}.ref_bom_id`],
          row.bom_type !== "reference"
        );
      })
    );

    if (pageStatus === "View") {
      applyViewMode();
    }
  } catch (error) {
    console.error("Error in BOM mounted function:", error);
    this.$message.error(error.message || "An error occurred");
  }
})();
