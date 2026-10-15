(async () => {
  const itemCodes = this.getValue(`item_code`);
  const organizationId =
    this.getVarGlobal("deptParentId") === "0"
      ? this.getVarSystem("deptIds")
      : this.getVarGlobal("deptParentId");

  console.log("organization id", organizationId);

  const currentItemArray = this.getValue(`item_array`);

  const itemCodeArray = itemCodes.split("\n");

  console.log("itemCodeArray", itemCodeArray);

  // Codes compare as in the database (case, trailing blanks); unknown ones are named.
  const codeKey = (code) => String(code ?? "").toLowerCase().trimEnd();
  const codes = [...new Set(itemCodeArray.filter((code) => code !== ""))];
  const chunks = [];
  for (let i = 0; i < codes.length; i += 500) {
    chunks.push(codes.slice(i, i + 500));
  }
  const resItems = await Promise.all(
    chunks.map((chunk) =>
      db
        .collection("Item")
        .field(
          "material_code,material_name,material_desc,based_uom,table_uom_conversion,item_category,item_batch_management,stock_control,serial_number_management,further_description",
        )
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "material_code", operator: "in", value: chunk },
              { prop: "organization_id", operator: "equal", value: organizationId },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ])
        .get(),
    ),
  );
  const itemByCode = new Map();
  resItems.forEach((response) =>
    (response.data || []).forEach((item) => {
      const key = codeKey(item.material_code);
      if (!itemByCode.has(key)) itemByCode.set(key, item);
    }),
  );

  const itemData = itemCodeArray
    .filter((code) => code !== "")
    .map((code) => itemByCode.get(codeKey(code)));
  const missing = [
    ...new Set(
      itemCodeArray.filter(
        (code) => code !== "" && !itemByCode.has(codeKey(code)),
      ),
    ),
  ];

  if (missing.length > 0) {
    this.$message.warning(`Item code not found: ${missing.join(", ")}`);
  }

  for (const item of itemData.filter(Boolean)) {
    currentItemArray.push({
      id: item.id,
      material_code: item.material_code,
      material_name: item.material_name,
      material_desc: item.material_desc,
      based_uom: item.based_uom,
      table_uom_conversion: item.table_uom_conversion,
      item_category: item.item_category,
      item_batch_management: item.item_batch_management,
      stock_control: item.stock_control,
      serial_number_management: item.serial_number_management,
      further_description: item.further_description,
    });
  }

  console.log("currentItemArray", currentItemArray);

  const updatedItemCode = currentItemArray.map((item) => item.material_code);

  console.log("updatedItemCode", updatedItemCode.join(", "));

  this.setData({
    [`item_code_array`]: updatedItemCode.join("\n"),
    [`item_array`]: currentItemArray,
  });

  const selectedRecords =
    this.getComponent("item_table").$refs.crud.tableSelect;

  console.log("selectedRecords", selectedRecords);

  await this.$nextTick();
  this.getComponent("item_table").$refs.crud.clearSelection();

  await this.$nextTick();
  this.getComponent("item_table").$refs.crud.toggleSelection(
    currentItemArray,
    true,
  );
})();
