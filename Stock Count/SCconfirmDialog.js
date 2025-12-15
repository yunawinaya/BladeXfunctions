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
        unrestricted_qty: parseFloat(item.unrestricted_qty),
        reserved_qty: parseFloat(item.reserved_qty),
        block_qty: parseFloat(item.block_qty),
        intransit_qty: parseFloat(item.intransit_qty),
        qualityinsp_qty: parseFloat(item.qualityinsp_qty),
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
      // Create detailed balance distribution string with improved formatting
      const details = [];
      const totalQty = item.balance_quantity || 0;

      // Add each non-zero category with bullet points and proper spacing
      if (item.unrestricted_qty > 0) {
        details.push(`  • Unrestricted: ${item.unrestricted_qty}`);
      }
      if (item.reserved_qty > 0) {
        details.push(`  • Reserved: ${item.reserved_qty}`);
      }
      if (item.block_qty > 0) {
        details.push(`  • Blocked: ${item.block_qty}`);
      }
      if (item.qualityinsp_qty > 0) {
        details.push(`  • Quality Inspection: ${item.qualityinsp_qty}`);
      }
      if (item.intransit_qty > 0) {
        details.push(`  • In Transit: ${item.intransit_qty}`);
      }

      // Format with clear header and breakdown section
      const balanceDistribution = details.length > 0
        ? `TOTAL: ${totalQty}\n\nBreakdown:\n${details.join('\n')}`
        : `TOTAL: ${totalQty}`;

      table_stock_count.push({
        material_id: item.item_id,
        material_name: item.item_name,
        material_desc: item.material_desc,
        item_category: item.item_category,
        uom_id: item.uom_id,
        base_uom_id: item.uom_id,
        table_uom_conversion: item.table_uom_conversion,
        balance_distribution: balanceDistribution,
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

      if (!acc[locationId]) {
        acc[locationId] = {
          location: locationName,
          total_qty: 0,
          unrestricted_qty: 0,
          reserved_qty: 0,
          block_qty: 0,
          qualityinsp_qty: 0,
          intransit_qty: 0,
        };
      }

      // Aggregate all quantity types
      acc[locationId].total_qty += item.balance_quantity || 0;
      acc[locationId].unrestricted_qty += item.unrestricted_qty || 0;
      acc[locationId].reserved_qty += item.reserved_qty || 0;
      acc[locationId].block_qty += item.block_qty || 0;
      acc[locationId].qualityinsp_qty += item.qualityinsp_qty || 0;
      acc[locationId].intransit_qty += item.intransit_qty || 0;

      return acc;
    }, {});

    // Format the result with detailed breakdown
    const formattedResult = Object.values(result).map((item) => {
      const details = [];

      if (item.unrestricted_qty > 0) {
        details.push(`  - Unrestricted: ${item.unrestricted_qty} Qty`);
      }
      if (item.reserved_qty > 0) {
        details.push(`  - Reserved: ${item.reserved_qty} Qty`);
      }
      if (item.block_qty > 0) {
        details.push(`  - Blocked: ${item.block_qty} Qty`);
      }
      if (item.qualityinsp_qty > 0) {
        details.push(`  - Quality Inspection: ${item.qualityinsp_qty} Qty`);
      }
      if (item.intransit_qty > 0) {
        details.push(`  - In Transit: ${item.intransit_qty} Qty`);
      }

      return {
        location: item.location,
        quantity: `Total: ${item.total_qty} Qty\n${details.join('\n')}`,
      };
    });

    console.log("formattedResult", formattedResult);

    this.display("summary");
    this.models["_data"] = formattedResult;

    this.closeDialog("dialog_select_stock");
  }
})();
