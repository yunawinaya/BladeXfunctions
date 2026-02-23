// Helper function to convert quantity from alt UOM to base UOM
const convertToBaseUOM = (quantity, altUOM, itemData) => {
  if (!altUOM || altUOM === itemData.based_uom) {
    return quantity;
  }

  const uomConversion = itemData.table_uom_conversion?.find(
    (conv) => conv.alt_uom_id === altUOM,
  );

  if (uomConversion && uomConversion.base_qty) {
    return quantity * uomConversion.base_qty;
  }

  return quantity;
};

if (!window.globalAllocationTracker) {
  window.globalAllocationTracker = new Map();
}

const createTableGdWithBaseUOM = async (allItems) => {
  const processedItems = [];

  // Helper function to add gd_quantity to temp_qty_data
  const addGdQuantityToTempData = (tempQtyDataString) => {
    if (!tempQtyDataString) return null;

    try {
      const tempDataArray = JSON.parse(tempQtyDataString);

      // Add gd_quantity to each item in temp_qty_data
      // For GDPP, gd_quantity should match to_quantity from PP (the picked quantity per location)
      const updatedTempData = tempDataArray.map((item) => ({
        ...item,
        gd_quantity: item.to_quantity || 0, // Initialize gd_quantity with to_quantity from PP
      }));

      return JSON.stringify(updatedTempData);
    } catch (error) {
      console.error("Error parsing temp_qty_data:", error);
      return tempQtyDataString; // Return original if parse fails
    }
  };

  for (const item of allItems) {
    // Check if item is serialized
    let itemData = null;
    if (item.itemId) {
      try {
        const res = await db
          .collection("Item")
          .where({ id: item.itemId })
          .get();
        itemData = res.data?.[0];
      } catch (error) {
        console.error(`Error fetching item data for ${item.itemId}:`, error);
      }
    }

    // GD Quantity Logic for PP:
    // - gd_order_quantity = Original SO qty (to_order_quantity)
    // - plan_qty = Remaining to deliver (to_qty - gd_delivered_qty)
    // - gd_qty = Auto-allocated to remaining qty
    // - gd_initial_delivered_qty = Already delivered (gd_delivered_qty from PP)
    // - gd_delivered_qty = Total picked qty (to_qty)
    // - gd_undelivered_qty = SO qty - picked qty (gap between ordered and picked)

    const soOrderedQty = item.orderedQty; // to_order_quantity (10)
    const pickedQty = item.pickedQty; // to_qty (8)
    const alreadyDelivered = item.deliveredQty || 0; // gd_delivered_qty from PP (5 after first GD)
    const remainingToDeliver = pickedQty - alreadyDelivered; // 8 - 5 = 3
    const undeliveredQty = soOrderedQty - pickedQty; // 10 - 8 = 2

    // If serialized, convert to base UOM
    if (itemData?.serial_number_management === 1) {
      const soOrderedQtyBase = convertToBaseUOM(
        soOrderedQty,
        item.altUOM,
        itemData,
      );
      const pickedQtyBase = convertToBaseUOM(pickedQty, item.altUOM, itemData);
      const alreadyDeliveredBase = convertToBaseUOM(
        alreadyDelivered,
        item.altUOM,
        itemData,
      );
      const remainingToDeliverBase = convertToBaseUOM(
        remainingToDeliver,
        item.altUOM,
        itemData,
      );
      const undeliveredQtyBase = convertToBaseUOM(
        undeliveredQty,
        item.altUOM,
        itemData,
      );

      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: soOrderedQtyBase, // Original SO qty in base UOM
        plan_qty: remainingToDeliverBase, // Remaining to deliver (to_qty - gd_delivered_qty)
        gd_qty: remainingToDeliverBase, // Auto-allocated to remaining qty
        gd_initial_delivered_qty: alreadyDeliveredBase, // Already delivered (gd_delivered_qty)
        gd_delivered_qty: pickedQtyBase, // Total picked qty (to_qty)
        gd_undelivered_qty: undeliveredQtyBase, // Gap between SO and picked
        gd_order_uom_id: itemData.based_uom, // Base UOM
        good_delivery_uom_id: itemData.based_uom, // Base UOM
        base_uom_id: itemData.based_uom,
        unit_price: item.unit_price || 0,
        total_price: item.total_price || 0,
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        line_to_id: item.pp_id,
        line_to_no: item.pp_no,
        to_line_item_id: item.pp_line_id,
        item_category_id: item.item_category_id,
        temp_qty_data: addGdQuantityToTempData(item.temp_qty_data),
        plan_temp_qty_data: item.temp_qty_data,
        view_stock: item.view_stock,
        plan_view_stock: item.view_stock,
        fifo_sequence: item.fifo_sequence,
        item_costing_method: item.item_costing_method,
        plant_id: item.plant_id,
        customer_id: item.customer_id,
        is_force_complete: item.is_force_complete,
        picking_status: item.picking_status,
      });
    } else {
      // Non-serialized items keep original UOM
      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: soOrderedQty, // Original SO qty
        plan_qty: remainingToDeliver, // Remaining to deliver (to_qty - gd_delivered_qty)
        gd_qty: remainingToDeliver, // Auto-allocated to remaining qty
        gd_initial_delivered_qty: alreadyDelivered, // Already delivered (gd_delivered_qty)
        gd_delivered_qty: pickedQty, // Total picked qty (to_qty)
        gd_undelivered_qty: undeliveredQty, // Gap between SO and picked
        gd_order_uom_id: item.altUOM,
        good_delivery_uom_id: item.altUOM,
        base_uom_id: item.baseUOM,
        unit_price: item.unit_price || 0,
        total_price: item.total_price || 0,
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        line_to_id: item.pp_id,
        line_to_no: item.pp_no,
        to_line_item_id: item.pp_line_id,
        item_category_id: item.item_category_id,
        temp_qty_data: addGdQuantityToTempData(item.temp_qty_data),
        plan_temp_qty_data: item.temp_qty_data,
        view_stock: item.view_stock,
        plan_view_stock: item.view_stock,
        fifo_sequence: item.fifo_sequence,
        item_costing_method: item.item_costing_method,
        plant_id: item.plant_id,
        customer_id: item.customer_id,
        is_force_complete: item.is_force_complete,
        picking_status: item.picking_status,
      });
    }
  }

  return processedItems;
};

(async () => {
  const referenceType = this.getValue(`dialog_select_picking.reference_type`);
  const previousReferenceType = this.getValue("reference_type");
  const currentItemArray = this.getValue(`dialog_select_picking.item_array`);
  let existingGD = this.getValue("table_gd");
  const customerName = this.getValue("customer_name");

  console.log("currentItemArray", currentItemArray);
  console.log("referenceType", referenceType);
  console.log("previousReferenceType", previousReferenceType);
  console.log("existingGD", existingGD);
  console.log("customerName", customerName);

  // Reset global allocation tracker when starting fresh (no existing data)
  if (!window.globalAllocationTracker) {
    window.globalAllocationTracker = new Map();
  } else if (!existingGD || existingGD.length === 0) {
    // Clear tracker only when no existing GD data (fresh start)
    window.globalAllocationTracker.clear();
  }

  let allItems = [];
  let salesOrderNumber = [];
  let soId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one sales order / item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  if (previousReferenceType && previousReferenceType !== referenceType) {
    await this.$confirm(
      `You've selected a different reference type than previously used. <br><br>Current Reference Type: ${referenceType} <br>Previous Reference Type: ${previousReferenceType} <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Reference Type Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingGD = [];
  }

  const uniqueCustomer = new Set(
    currentItemArray.map((so) =>
      referenceType === "Document"
        ? Array.isArray(so.customer_id)
          ? so.customer_id[0]
          : so.customer_id
        : so.customer_id.id,
    ),
  );
  const allSameCustomer = uniqueCustomer.size === 1;

  if (!allSameCustomer) {
    this.$alert(
      "Deliver item(s) to more than two different customers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    return;
  }

  if (customerName && customerName !== [...uniqueCustomer][0]) {
    await this.$confirm(
      `You've selected a different customer than previously used. <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Customer Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingGD = [];
  }

  this.closeDialog("dialog_select_picking");
  this.showLoading();

  switch (referenceType) {
    case "Document":
      // Document mode: Take all items from selected Picking Plan(s)
      // Filter out fully delivered line items from table_to
      for (const pp of currentItemArray) {
        // Filter table_to to exclude fully delivered line items
        const availableLineItems = (pp.table_to || []).filter(
          (lineItem) => lineItem.delivery_status !== "Fully Delivered",
        );

        console.log(
          `PP ${pp.to_no}: ${pp.table_to.length} total items, ${
            availableLineItems.length
          } available (${
            pp.table_to.length - availableLineItems.length
          } fully delivered)`,
        );

        for (const ppItem of availableLineItems) {
          console.log("ppItem", ppItem);
          allItems.push({
            itemId: ppItem.material_id,
            itemName: ppItem.material_name,
            itemDesc: ppItem.to_material_desc || "",
            orderedQty: parseFloat(ppItem.to_order_quantity || 0), // Original SO quantity
            pickedQty: parseFloat(ppItem.to_qty || 0), // Actually picked quantity
            deliveredQty: parseFloat(ppItem.gd_delivered_qty || 0), // Already delivered via GD (field from PP)
            delivery_status: ppItem.delivery_status || "", // Line item delivery status
            altUOM: ppItem.to_order_uom_id || "",
            baseUOM: ppItem.base_uom_id || "",
            sourceItem: ppItem,
            original_so_id: ppItem.line_so_id, // SO header ID
            so_no: ppItem.line_so_no, // SO number
            so_line_item_id: ppItem.so_line_item_id, // SO line item ID
            pp_id: pp.picking_plan_id,
            pp_no: pp.to_no,
            pp_line_id: ppItem.id,
            item_category_id: ppItem.item_category_id,
            temp_qty_data: ppItem.temp_qty_data, // Location/batch details
            view_stock: ppItem.view_stock,
            fifo_sequence: ppItem.fifo_sequence,
            unit_price: ppItem.unit_price,
            total_price: ppItem.total_price,
            item_costing_method: ppItem.item_costing_method,
            plant_id: ppItem.plant_id,
            customer_id: ppItem.customer_id,
            is_force_complete: ppItem.is_force_complete || 0,
            picking_status: ppItem.picking_status,
          });
        }
      }
      break;

    case "Item":
      // Item mode: Take selected individual PP line items
      for (const ppItem of currentItemArray) {
        console.log("ppItem (Item mode)", ppItem);
        allItems.push({
          itemId: ppItem.item.id,
          itemName: ppItem.item.material_code,
          itemDesc: ppItem.to_material_desc || "",
          orderedQty: parseFloat(ppItem.to_order_quantity || 0), // SO ordered qty
          pickedQty: parseFloat(ppItem.to_qty || 0), // Actually picked qty
          deliveredQty: parseFloat(ppItem.gd_delivered_qty || 0), // Already delivered via GD (field from PP)
          delivery_status: ppItem.delivery_status || "", // Line item delivery status
          altUOM: ppItem.to_order_uom_id || "",
          baseUOM: ppItem.base_uom_id || "",
          sourceItem: ppItem,
          original_so_id: ppItem.line_so_id,
          so_no: ppItem.line_so_no,
          so_line_item_id: ppItem.so_line_item_id,
          pp_id: ppItem.picking_plan.id,
          pp_no: ppItem.picking_plan.to_no,
          pp_line_id: ppItem.picking_plan_line_id,
          item_category_id: ppItem.item_category_id,
          temp_qty_data: ppItem.temp_qty_data,
          view_stock: ppItem.view_stock,
          fifo_sequence: ppItem.fifo_sequence,
          unit_price: ppItem.unit_price,
          total_price: ppItem.total_price,
          item_costing_method: ppItem.item_costing_method,
          plant_id: ppItem.plant_id,
          customer_id: ppItem.customer_id.id,
          is_force_complete: ppItem.is_force_complete || 0,
          picking_status: ppItem.picking_plan.picking_status,
        });
      }
      break;
  }

  console.log("allItems", allItems);

  // Filter out items that:
  // 1. Are fully delivered (delivery_status === "Fully Delivered")
  // 2. Are already in the existing GD (match by pp_line_id to avoid duplicates)
  allItems = allItems.filter((item) => {
    const fullyDelivered = item.delivery_status === "Fully Delivered";
    const alreadyInGD = existingGD.find(
      (gdItem) => gdItem.pp_line_id === item.pp_line_id,
    );

    if (fullyDelivered) {
      console.log(
        `Filtering out ${item.itemName}: ${item.delivery_status} (${item.deliveredQty}/${item.pickedQty})`,
      );
    }
    if (alreadyInGD) {
      console.log(
        `Filtering out ${item.itemName}: already in GD (pp_line_id: ${item.pp_line_id})`,
      );
    }

    return !fullyDelivered && !alreadyInGD;
  });

  console.log("allItems after filter", allItems);

  let newTableGd = await createTableGdWithBaseUOM(allItems);

  const latestTableGD = [...existingGD, ...newTableGd];

  soId = [...new Set(latestTableGD.map((gr) => gr.line_so_id))];
  salesOrderNumber = [...new Set(latestTableGD.map((gr) => gr.line_so_no))];

  // Collect unique PP numbers for reference
  const ppNumbers = [...new Set(latestTableGD.map((gr) => gr.line_to_no))];

  await this.setData({
    currency_code:
      referenceType === "Document"
        ? currentItemArray[0].so_currency?.[0] || null
        : null,
    customer_name:
      referenceType === "Document"
        ? currentItemArray[0].customer_id[0]
        : currentItemArray[0].customer_id.id,
    table_gd: latestTableGD,
    so_no: salesOrderNumber.join(", "),
    so_id: soId,
    pp_no: ppNumbers.join(", "), // Add PP reference
    reference_type: referenceType,
  });

  await this.display(["table_gd.line_to_no", "table_gd.plan_qty"]);

  // GDPP: Enable/disable fields based on temp_qty_data length
  setTimeout(() => {
    for (let i = 0; i < latestTableGD.length; i++) {
      const item = latestTableGD[i];
      const tempQtyData = item.temp_qty_data;

      if (!tempQtyData || tempQtyData === "[]" || tempQtyData.trim() === "") {
        continue;
      }

      try {
        const tempDataArray = JSON.parse(tempQtyData);

        if (tempDataArray.length === 1) {
          // Single location: Disable dialog button, enable gd_qty field
          this.disabled([`table_gd.${i}.gd_delivery_qty`], true);
          this.disabled([`table_gd.${i}.gd_qty`], false);
          console.log(`Item ${i}: Single location - direct edit enabled`);
        } else {
          // Multiple locations: Enable dialog button, disable gd_qty field
          this.disabled([`table_gd.${i}.gd_delivery_qty`], false);
          this.disabled([`table_gd.${i}.gd_qty`], true);
          console.log(
            `Item ${i}: Multiple locations (${tempDataArray.length}) - dialog required`,
          );
        }
      } catch (error) {
        console.error(`Error parsing temp_qty_data for item ${i}:`, error);
      }
    }
  }, 100);

  this.hideLoading();
})();
