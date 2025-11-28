(async () => {
  try {
    const tableItems = this.getValue("table_items");
    const tableHU = this.getValue("table_hu");
    const rowIndex = arguments[0].rowIndex;
    const tempData = tableHU[rowIndex].temp_data;
    let parsedTempData;
    if (tempData) {
      try {
        parsedTempData = JSON.parse(tempData);
      } catch (parseError) {
        console.error("Error parsing temp_data:", parseError);
        parsedTempData = null;
      }
    }

    console.log("Parsed temp data:", parsedTempData);

    if (!tableItems || !tableHU) {
      throw new Error("Table items or table HU is not available");
    }

    await this.openDialog("dialog_select_items");

    await this.setData({
      dialog_select_items: {
        hu_material_id: tableHU[rowIndex].hu_material_id,
        hu_type: tableHU[rowIndex].hu_type,
        hu_uom: tableHU[rowIndex].hu_uom,
        row_index: rowIndex,
        table_select_items: [],
      },
    });

    // Always start fresh from table items to get correct total_quantity
    // Then overlay quantity_to_pack from temp_data if editing
    let tableSelectItems = [];

    tableItems.forEach((item, index) => {
      tableSelectItems.push({
        item_code: item.item_code,
        item_name: item.item_name,
        item_desc: item.item_desc,
        batch_no: item.batch_no || "",
        item_uom: item.item_uom,
        total_quantity: parseFloat(item.total_quantity) || 0,
        quantity_to_pack: 0,
        line_index: index,
        line_item_id: item.id || "",
      });
    });

    // If editing existing HU, restore the quantity_to_pack from temp_data
    if (
      parsedTempData &&
      Array.isArray(parsedTempData) &&
      parsedTempData.length > 0
    ) {
      parsedTempData.forEach((tempItem) => {
        const matchingItem = tableSelectItems.find(
          (selectItem) =>
            selectItem.line_index === tempItem.line_index ||
            (selectItem.line_item_id &&
              tempItem.line_item_id &&
              selectItem.line_item_id === tempItem.line_item_id)
        );

        if (matchingItem) {
          matchingItem.quantity_to_pack = parseFloat(tempItem.quantity_to_pack) || 0;
        }
      });
    }

    // Collect all packed data from ALL HU rows (including current row for now)
    let allPackedData = [];

    tableHU.forEach((huItem, huIndex) => {
      if (huItem.temp_data) {
        try {
          const parsed = JSON.parse(huItem.temp_data);
          if (Array.isArray(parsed)) {
            // Flatten array of packed items, but mark which row it came from
            const markedItems = parsed.map((item) => ({
              ...item,
              _fromRowIndex: huIndex,
            }));
            allPackedData.push(...markedItems);
          }
        } catch (parseError) {
          console.error(
            `Error parsing temp_data for HU row ${huIndex}:`,
            parseError
          );
        }
      }
    });

    console.log("All packed data:", allPackedData);

    // Calculate packed quantity for each item (excluding current row's data)
    tableSelectItems.forEach((item) => {
      let totalPackedQty = 0;

      allPackedData.forEach((packedItem) => {
        // Skip if this packed item came from the current row
        if (packedItem._fromRowIndex === rowIndex) {
          return;
        }

        // Match by line_index or line_item_id
        const matchByIndex = packedItem.line_index === item.line_index;
        const matchById =
          packedItem.line_item_id &&
          item.line_item_id &&
          packedItem.line_item_id === item.line_item_id;

        if (matchByIndex || matchById) {
          totalPackedQty += parseFloat(packedItem.quantity_to_pack) || 0;
        }
      });

      item.packed_qty = totalPackedQty;
    });

    console.log("Table select items:", tableSelectItems);

    await this.setData({
      "dialog_select_items.table_select_items": tableSelectItems,
    });

    console.log("Dialog select items:", this.getValue("dialog_select_items"));
  } catch (error) {
    this.$message.error(
      "Error in PackingOpenSelectItemDialog: " + error.message
    );
    console.error("Error in PackingOpenSelectItemDialog:", error);
  }
})();
