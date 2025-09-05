(async () => {
  try {
    const gdNo = await this.getValue("gd_no");

    const viewSerialNumber = async () => {
      const table_picking_items = this.getValue("table_picking_items");
      const table_picking_records = this.getValue("table_picking_records");
      if (table_picking_items.length > 0) {
        for (const picking of table_picking_items) {
          if (picking.is_serialized_item === 1) {
            await this.display("table_picking_items.select_serial_number");
          }
        }
      }
      if (table_picking_records.length > 0) {
        for (const picking of table_picking_records) {
          if (
            picking.serial_numbers !== "" &&
            picking.serial_numbers !== null
          ) {
            await this.display("table_picking_records.serial_numbers");
          }
        }
      }
    };

    const setSerialNumber = async () => {
      try {
        const table_picking_items = this.getValue("table_picking_items");

        // Check if table_picking_items exists and is an array
        if (
          !Array.isArray(table_picking_items) ||
          table_picking_items.length === 0
        ) {
          console.log("No picking items found or invalid data structure");
          return;
        }

        for (const [index, picking] of table_picking_items.entries()) {
          try {
            // Check if item is serialized
            if (picking.is_serialized_item === 1) {
              console.log(
                `Processing serialized item at index ${index}:`,
                picking.item_code || picking.id
              );

              // Check if serial_numbers exists and is not empty
              if (
                !picking.serial_numbers ||
                picking.serial_numbers === null ||
                picking.serial_numbers === undefined ||
                typeof picking.serial_numbers !== "string" ||
                picking.serial_numbers.trim() === ""
              ) {
                console.warn(
                  `No valid serial numbers found for item at index ${index}`
                );
                continue;
              }

              console.log("Picking Serial Numbers", picking.serial_numbers);

              // Split and clean serial numbers
              const serialNumbers = picking.serial_numbers
                .split(",")
                .map((sn) => sn.trim())
                .filter((sn) => sn !== "");

              if (serialNumbers.length === 0) {
                console.warn(
                  `No valid serial numbers after processing for item at index ${index}`
                );
                continue;
              }

              console.log(
                `Setting ${serialNumbers.length} serial numbers for item at index ${index}:`,
                serialNumbers
              );

              // Set option data for select dropdown
              await this.setOptionData(
                [`table_picking_items.${index}.select_serial_number`],
                serialNumbers
              );

              // Set the actual data
              await this.setData({
                [`table_picking_items.${index}.select_serial_number`]:
                  serialNumbers,
              });

              // Disable picked_qty field for serialized items
              await this.disabled(
                [`table_picking_items.${index}.picked_qty`],
                true
              );

              console.log(
                `Successfully set serial numbers for item at index ${index}`
              );
            }
          } catch (itemError) {
            console.error(
              `Error processing item at index ${index}:`,
              itemError
            );
            // Continue with next item instead of breaking the entire function
            continue;
          }
        }
      } catch (error) {
        console.error("Error in setSerialNumber function:", error);
        // Don't throw error to prevent breaking the entire onMounted flow
      }
    };

    const gdData = await db
      .collection("goods_delivery")
      .where({ id: gdNo })
      .get()
      .then((response) => {
        if (response.data && response.data.length > 0) {
          return response.data[0];
        }
        return null;
      });

    let tablePickingItems = [];

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Prepare picking items with grouping for serialized items (similar to createOrUpdatePicking)
    const pickingItemGroups = new Map();

    gdData.table_gd.forEach((item) => {
      if (item.temp_qty_data && item.material_id) {
        try {
          const tempData = JSON.parse(item.temp_qty_data);

          tempData.forEach((tempItem) => {
            const materialId = tempItem.material_id || item.material_id;
            // Create a grouping key based on item, batch, and location
            const groupKey = `${materialId}_${
              tempItem.batch_id || "no-batch"
            }_${tempItem.location_id}`;

            if (!pickingItemGroups.has(groupKey)) {
              // Create new group
              pickingItemGroups.set(groupKey, {
                item_code: String(materialId),
                item_name: item.material_name,
                item_desc: item.gd_material_desc || "",
                batch_no: tempItem.batch_id ? String(tempItem.batch_id) : null,
                qty_to_pick: 0,
                item_uom: String(item.gd_order_uom_id),
                source_bin: String(tempItem.location_id),
                pending_process_qty: 0,
                line_status: "Open",
                so_no: item.line_so_no,
                serial_numbers: [],
                is_serialized_item: 0,
              });
            }

            const group = pickingItemGroups.get(groupKey);
            group.qty_to_pick += parseFloat(tempItem.gd_quantity);
            group.pending_process_qty += parseFloat(tempItem.gd_quantity);

            // Add serial number if exists
            if (tempItem.serial_number) {
              group.serial_numbers.push(String(tempItem.serial_number));
              group.is_serialized_item = 1;
            }
          });
        } catch (error) {
          console.error(
            `Error parsing temp_qty_data for picking: ${error.message}`
          );
        }
      }
    });

    // Convert grouped items to picking items array
    pickingItemGroups.forEach((group) => {
      // Format serial numbers with comma separation if any exist
      if (group.serial_numbers.length > 0) {
        group.serial_numbers = group.serial_numbers.join(", ");
      } else {
        delete group.serial_numbers;
      }

      tablePickingItems.push(group);
    });

    await this.setData({
      so_no: gdData.so_no,
      delivery_no: gdData.delivery_no,
      table_picking_items: tablePickingItems,
      customer_id: gdData.customer_name,
      created_by: this.getVarGlobal("nickname"),
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      organization_id: organizationId,
    });

    // Setup serialized items after data is set
    await viewSerialNumber();
    await setSerialNumber();
  } catch (error) {
    console.error("Error fetching Goods Delivery:", error);
  }
})();
