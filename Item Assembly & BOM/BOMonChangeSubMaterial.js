(async () => {
  try {
    const { value, rowIndex, fieldModel } = arguments[0];
    const rowPrefix = `subform_sub_material.${rowIndex}`;

    if (!value) {
      this.setData({
        [`${rowPrefix}.sub_material_name`]: "",
        [`${rowPrefix}.sub_material_desc`]: "",
        [`${rowPrefix}.sub_material_category`]: null,
        [`${rowPrefix}.sub_material_qty_uom`]: null,
        [`${rowPrefix}.sub_material_qty`]: 0,
        [`${rowPrefix}.sub_material_wastage`]: 0,
        [`${rowPrefix}.sub_material_remark`]: "",
        [`${rowPrefix}.bom_type`]: "standard",
        [`${rowPrefix}.consume_type`]: "USE",
        [`${rowPrefix}.ref_bom_id`]: null,
      });
      this.setOptionData(`${rowPrefix}.ref_bom_id`, []);
      this.disabled([`${rowPrefix}.ref_bom_id`], true);
      return;
    }

    // Same fallback as the header picker: read the item back when the event
    // payload does not carry it.
    let item = fieldModel?.item;
    if (!item || !item.material_name) {
      const res = await db
        .collection("item")
        .field("material_name,material_desc,item_category,based_uom")
        .where({ id: value })
        .get()
        .catch((error) => {
          console.error("Error fetching sub material item:", error);
          return { data: [] };
        });
      item = (res.data || [])[0] || {};
    }

    this.setData({
      [`${rowPrefix}.sub_material_name`]: item.material_name || "",
      [`${rowPrefix}.sub_material_desc`]: item.material_desc || "",
      [`${rowPrefix}.sub_material_category`]: item.item_category || null,
      [`${rowPrefix}.sub_material_qty_uom`]: item.based_uom || null,
      [`${rowPrefix}.bom_type`]: "standard",
      [`${rowPrefix}.consume_type`]: "USE",
      [`${rowPrefix}.ref_bom_id`]: null,
    });

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const res = await db
      .collection("bill_of_materials")
      .where({
        parent_material_code: value,
        organization_id: organizationId,
        is_deleted: 0,
        is_active: 1,
      })
      .get();

    // Raw rows would drag their whole subform_sub_material array into the
    // option store; project down to what props + {label,value} need.
    this.setOptionData(
      `${rowPrefix}.ref_bom_id`,
      (res.data || []).map((record) => ({
        id: record.id,
        parent_mat_bom_version: record.parent_mat_bom_version,
        value: record.id,
        label: record.parent_mat_bom_version,
      }))
    );

    // ref_bom_id only applies to a reference line; onChange_bom_type owns it.
    this.disabled([`${rowPrefix}.ref_bom_id`], true);
  } catch (error) {
    console.error("Error loading sub material data:", error);
    this.$message.error(error.message || "Failed to load the sub material");
  }
})();
