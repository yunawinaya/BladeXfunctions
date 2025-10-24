(async () => {
  let selectBatchs = this.getComponent("dialog_select_stock.batch_balance")
    ?.$refs.crud.tableSelect;

  const plantId = this.getValue("plant_id");

  const selectItems = this.models["itemList"] || [];

  // Check if both selectItems and selectBatchs are empty
  if (
    (!selectItems || selectItems.length === 0) &&
    (!selectBatchs || selectBatchs.length === 0)
  ) {
    this.$message.error(
      "No item selected or select item button hasn't been pressed"
    );
    return;
  }

  // Handle case where selectBatchs might be empty or undefined
  if (selectBatchs && selectBatchs.length > 0) {
    // Create a lookup map for faster matching
    const itemLookup = {};
    selectItems.forEach((item) => {
      itemLookup[item.item_id] = item;
    });

    selectBatchs = selectBatchs.map((item) => {
      const matchedItem = itemLookup[item.item_id];

      return {
        item_id: item.item_id,
        item_name: item.item_name,
        balance_quantity: parseFloat(item.balance_quantity),
        location_id: item.location_id,
        batch_id: item.batch_id,
        uom_id: matchedItem?.uom_id,
        material_desc: matchedItem?.material_desc,
        item_category: matchedItem?.item_category,
        table_uom_conversion: matchedItem?.table_uom_conversion,
      };
    });
  } else {
    // If no batch data, set selectBatchs to empty array
    selectBatchs = [];
  }

  if (selectItems && selectItems.length > 0) {
    const batchItemIds = new Set(selectBatchs.map((item) => item.item_id));

    const selectItemsFiltered = selectItems.filter(
      (item) => !batchItemIds.has(item.item_id)
    );

    const allData = [...selectBatchs, ...selectItemsFiltered];
    console.log("allData", allData);

    let table_stock_count = [];
    allData.forEach((item) => {
      table_stock_count.push({
        material_id: item.item_id,
        material_name: item.item_name,
        material_desc: item.material_desc,
        item_category: item.item_category,
        uom_id: item.uom_id,
        base_uom_id: item.uom_id,
        table_uom_conversion: item.table_uom_conversion,
        system_qty: item.balance_quantity,
        location_id: item.location_id,
        batch_id: item.batch_id,
        line_status: "Pending",
        plant_id: plantId,
      });
    });

    await this.display("table_stock_count");
    await this.setData({ table_stock_count: table_stock_count });
    console.log("Submitted table_stock_count", table_stock_count);

    const locationMap = {};
    (this.models["locationList"] || []).forEach((location) => {
      locationMap[location.id] = location.name;
    });

    const result = allData.reduce((acc, item) => {
      const locationId = item.location_id;
      const locationName = locationMap[locationId] || locationId;
      const balanceQty = item.balance_quantity || 0;

      if (!acc[locationId]) {
        acc[locationId] = {
          location: locationName,
          quantity: 0,
        };
      }

      acc[locationId].quantity += balanceQty;
      return acc;
    }, {});
    console.log("result", Object.values(result));

    this.display("summary");
    this.models["_data"] = Object.values(result);

    this.closeDialog("dialog_select_stock");
  }
})();
