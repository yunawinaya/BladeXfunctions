for (const [index, gdLineItem] of allData.table_gd.entries()) {
  if (!gdLineItem.gd_qty || gdLineItem.gd_qty === 0) {
    continue;
  }

  // ============================================================================
  // PRECAUTION: Skip if gd_qty > 0 but temp_qty_data is empty
  // This prevents invalid state where quantity exists without allocation
  // ============================================================================
  const tempQtyData = gdLineItem.temp_qty_data;
  const isEmpty =
    !tempQtyData ||
    tempQtyData === "" ||
    tempQtyData === "[]" ||
    tempQtyData === null;

  if (isEmpty) {
    skippedRows.push({
      index: index,
      material_code: gdLineItem.material_code || "Unknown",
      material_name: gdLineItem.material_name || "Unknown",
      gd_qty: gdLineItem.gd_qty,
      so_no: gdLineItem.so_no || "",
    });
    continue;
  }

  gdLineItem.customer_id = allData.customer_name || null;
  gdLineItem.organization_id = allData.organization_id;
  gdLineItem.plant_id = allData.plant_id || null;
  gdLineItem.billing_state_id = allData.billing_address_state || null;
  gdLineItem.billing_country_id = allData.billing_address_country || null;
  gdLineItem.shipping_state_id = allData.shipping_address_state || null;
  gdLineItem.shipping_country_id = allData.shipping_address_country || null;
  gdLineItem.assigned_to = allData.assigned_to || null;
  gdLineItem.line_index = index + 1;

  if (isForceComplete === "Yes") {
    gdLineItem.picking_status = "Completed";
  } else if (saveAs === "Cancelled") {
    gdLineItem.picking_status = gdLineItem.picking_status ? "Cancelled" : null;
  }

  if (
    pickingSetup &&
    !allData.picking_status &&
    saveAs === "Created" &&
    pageStatus === "Add" &&
    pickingSetup.picking_required === 1
  ) {
    if (pickingSetup.auto_trigger_to === 1) {
      gdLineItem.picking_status = "Created";
    } else {
      gdLineItem.picking_status = "Not Created";
    }
  }

  updatedGD.push(gdLineItem);
}
