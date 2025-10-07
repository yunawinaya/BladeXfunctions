const handleSinglePicking = async (selectedRecords) => {
  try {
    let gdData = await fetchGDData(selectedRecords);
    gdData = gdData.map((item) => ({
      ...item,
      table_gd: item.table_gd.filter(
        (gdItem) => gdItem.picking_status === "Not Created"
      ),
    }));

    console.log("GD Data:", gdData);
    const gdIDs = gdData.map((gd) => gd.id);
    const gdNos = gdData.map((gd) => gd.delivery_no).join(", ");
    const soNos = [
      ...new Set(gdData.flatMap((gd) => gd.so_no.split(", "))),
    ].join(", ");
    const gdCustomers = [...new Set(gdData.map((gd) => gd.customer_name))];
    const uniquePlants = new Set(gdData.map((gd) => gd.plant_id));
    const allSamePlant = uniquePlants.size === 1;

    if (!allSamePlant) {
      this.$alert(
        "All selected goods deliveries must be from the same plant to create a single picking.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        }
      );
      return;
    }

    let pickingLineItemPromises = [];
    for (const gd of gdData) {
      const lineItemPromise = await mapLineItem(gd);
      pickingLineItemPromises.push(...lineItemPromise);
      console.log("Picking Line Item Promises:", pickingLineItemPromises);
    }

    const data = gdData[0];
    const plantID = data.plant_id;
    const pickingData = await mapToPickingData(
      pickingLineItemPromises,
      gdIDs,
      gdNos,
      soNos,
      gdCustomers,
      plantID
    );
    console.log("Mapped Picking Data:", pickingData);

    await this.toView({
      target: "1935556443668959233",
      type: "add",
      data: { ...pickingData },
      position: "rtl",
      mode: "dialog",
      width: "80%",
      title: "Add",
    });
  } catch (error) {
    console.error("Error in handlePicking:", error);
  }
};

const mapToPickingData = (
  pickingLineItemPromises,
  gdIDs,
  gdNos,
  soNos,
  gdCustomers,
  plantID
) => {
  return {
    so_no: soNos,
    delivery_no: gdNos,
    gd_no: gdIDs,
    table_picking_items: pickingLineItemPromises,
    customer_id: gdCustomers,
    plant_id: plantID,
  };
};

const mapLineItem = async (gdData) => {
  let tablePickingItems = [];
  const pickingItemGroups = new Map();

  for (const item of gdData.table_gd) {
    if (item.temp_qty_data && item.material_id) {
      try {
        const tempData = JSON.parse(item.temp_qty_data);
        console.log("Parsed temp_qty_data:", tempData);
        for (const tempItem of tempData) {
          const materialId = tempItem.material_id || item.material_id;
          // Create a grouping key based on item, batch, and location
          const groupKey = `${item.id}_${materialId}_${
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
              item_uom: item.good_delivery_uom_id,
              source_bin: String(tempItem.location_id),
              pending_process_qty: 0,
              line_status: "Open",
              so_no: item.line_so_no,
              gd_no: gdData.delivery_no,
              so_id: item.line_so_id,
              so_line_id: item.so_line_item_id,
              gd_id: gdData.id,
              gd_line_id: item.id,
              serial_numbers: [],
              is_serialized_item: 0,
            });

            console.log("Created new picking item group:", {
              ...pickingItemGroups.get(groupKey),
            });
          }

          const group = pickingItemGroups.get(groupKey);
          group.qty_to_pick += parseFloat(tempItem.gd_quantity);
          group.pending_process_qty += parseFloat(tempItem.gd_quantity);

          console.log("Updated picking item group:", { ...group });
          // Add serial number if exists
          if (tempItem.serial_number) {
            group.serial_numbers.push(String(tempItem.serial_number));
            group.is_serialized_item = 1;
          }
        }
      } catch (error) {
        console.error(
          `Error parsing temp_qty_data for picking: ${error.message}`
        );
      }
    }
  }

  console.log("Final picking item groups for GD No", gdData.delivery_no, ":", [
    ...pickingItemGroups,
  ]);
  // Convert grouped items to picking items array
  for (const group of pickingItemGroups.values()) {
    console.log("Processing group for final picking items:", group);
    if (group.serial_numbers.length > 0) {
      group.serial_numbers = group.serial_numbers.join(", ");
    } else {
      delete group.serial_numbers;
    }

    tablePickingItems.push({ ...group });
    console.log("tablePickingItems", tablePickingItems);
  }

  return tablePickingItems;
};

const fetchGDData = async (selectedRecords) => {
  try {
    const response = await Promise.all(
      selectedRecords.map((item) =>
        db.collection("goods_delivery").doc(item.id).get()
      )
    );

    const data = response.map((res) => res.data[0]);
    return data;
  } catch (error) {
    console.error("Error fetching GD data:", error);
    throw error;
  }
};

(async () => {
  try {
    const allListID = "custom_ezwb0qqp";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      selectedRecords = selectedRecords.filter((item) =>
        item.table_gd.some((gdItem) => gdItem.picking_status === "Not Created")
      );

      if (selectedRecords.length === 0) {
        await this.$alert(
          "No selected records are available for conversion. Please select records with picking status 'Not Created' or 'Created' or 'In Progress'.",
          "No Records to Convert",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "warning",
          }
        );
        return;
      }

      // Filter out records that are not "Not Created"
      await this.$confirm(
        `Only these goods delivery records available for conversion. Proceed?<br><br>
  <strong>Selected Records:</strong><br> ${selectedRecords
    .map((item) => {
      const totalItems = item.table_gd.length;
      const pickableItems = item.table_gd.filter(
        (gdItem) => gdItem.picking_status === "Not Created"
      ).length;
      return `${item.delivery_no} (${pickableItems}/${totalItems} items)`;
    })
    .join("<br>")}`,
        "Confirm Conversion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      if (selectedRecords.length > 0) {
        await handleSinglePicking(selectedRecords);
        await this.getComponent(allListID)?.$refs.crud.clearSelection();
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
