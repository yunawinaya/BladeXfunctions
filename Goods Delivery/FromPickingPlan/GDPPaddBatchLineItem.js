// Helper function to convert quantity from alt UOM to base UOM
const convertToBaseUOM = (quantity, altUOM, itemData) => {
  if (!altUOM || altUOM === itemData.based_uom) {
    return quantity;
  }

  const uomConversion = itemData.table_uom_conversion?.find(
    (conv) => conv.alt_uom_id === altUOM
  );

  if (uomConversion && uomConversion.alt_qty) {
    return quantity / uomConversion.alt_qty;
  }

  return quantity;
};

if (!window.globalAllocationTracker) {
  window.globalAllocationTracker = new Map();
}

const createTableGdWithBaseUOM = async (allItems) => {
  const processedItems = [];

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

    // If serialized, convert to base UOM
    if (itemData?.serial_number_management === 1) {
      const orderedQtyBase = convertToBaseUOM(
        item.orderedQty,
        item.altUOM,
        itemData
      );
      const deliveredQtyBase = convertToBaseUOM(
        item.deliveredQtyFromSource,
        item.altUOM,
        itemData
      );

      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: orderedQtyBase, // Base UOM
        gd_delivered_qty: deliveredQtyBase, // Base UOM
        gd_undelivered_qty: orderedQtyBase - deliveredQtyBase, // Base UOM
        gd_order_uom_id: itemData.based_uom, // Base UOM
        good_delivery_uom_id: itemData.based_uom, // Base UOM
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        item_category_id: item.item_category_id,
        base_uom_id: itemData.based_uom,
      });
    } else {
      // Non-serialized items keep original UOM
      processedItems.push({
        material_id: item.itemId || "",
        material_name: item.itemName || "",
        gd_material_desc: item.itemDesc || "",
        gd_order_quantity: item.orderedQty,
        gd_delivered_qty: item.deliveredQtyFromSource,
        gd_undelivered_qty: item.orderedQty - item.sourceItem.delivered_qty,
        gd_order_uom_id: item.altUOM,
        good_delivery_uom_id: item.altUOM,
        unit_price: item.sourceItem.so_item_price || 0,
        total_price: item.sourceItem.so_amount || 0,
        more_desc: item.sourceItem.more_desc || "",
        line_remark_1: item.sourceItem.line_remark_1 || "",
        line_remark_2: item.sourceItem.line_remark_2 || "",
        line_so_no: item.so_no,
        line_so_id: item.original_so_id,
        so_line_item_id: item.so_line_item_id,
        item_category_id: item.item_category_id,
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
      }
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingGD = [];
  }

  const uniqueCustomer = new Set(
    currentItemArray.map((so) =>
      referenceType === "Document" ? so.customer_id : so.customer_id.id
    )
  );
  const allSameCustomer = uniqueCustomer.size === 1;

  if (!allSameCustomer) {
    this.$alert(
      "Deliver item(s) to more than two different customers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      }
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
      }
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
      for (const so of currentItemArray) {
        for (const soItem of so.table_so) {
          console.log("soItem", soItem);
          allItems.push({
            itemId: soItem.item_name,
            itemName: soItem.item_id,
            itemDesc: soItem.so_desc,
            orderedQty: parseFloat(soItem.so_quantity || 0),
            altUOM: soItem.so_item_uom || "",
            sourceItem: soItem,
            deliveredQtyFromSource: parseFloat(soItem.delivered_qty || 0),
            original_so_id: so.sales_order_id,
            so_no: so.sales_order_number,
            so_line_item_id: soItem.id,
            item_category_id: soItem.item_category_id,
          });
        }
      }

      break;

    case "Item":
      for (const soItem of currentItemArray) {
        allItems.push({
          itemId: soItem.item.id,
          itemName: soItem.item.material_name,
          itemDesc: soItem.so_desc,
          orderedQty: parseFloat(soItem.so_quantity || 0),
          altUOM: soItem.so_item_uom || "",
          sourceItem: soItem,
          deliveredQtyFromSource: parseFloat(soItem.delivered_qty || 0),
          original_so_id: soItem.sales_order.id,
          so_no: soItem.sales_order.so_no,
          so_line_item_id: soItem.sales_order_line_id,
          item_category_id: soItem.item.item_category,
        });
      }
      break;
  }

  console.log("allItems", allItems);
  allItems = allItems.filter(
    (gd) =>
      gd.deliveredQtyFromSource !== gd.orderedQty &&
      !existingGD.find(
        (gdItem) => gdItem.so_line_item_id === gd.so_line_item_id
      )
  );

  console.log("allItems after filter", allItems);

  let newTableGd = await createTableGdWithBaseUOM(allItems);

  const latestTableGD = [...existingGD, ...newTableGd];

  soId = [...new Set(latestTableGD.map((gr) => gr.line_so_id))];
  salesOrderNumber = [...new Set(latestTableGD.map((gr) => gr.line_so_no))];

  await this.setData({
    currency_code:
      referenceType === "Document"
        ? currentItemArray[0].currency
        : currentItemArray[0].sales_order.so_currency,
    customer_name:
      referenceType === "Document"
        ? currentItemArray[0].customer_id
        : currentItemArray[0].customer_id.id,
    table_gd: latestTableGD,
    so_no: salesOrderNumber.join(", "),
    so_id: soId,
    reference_type: referenceType,
  });

  this.hideLoading();
})();
