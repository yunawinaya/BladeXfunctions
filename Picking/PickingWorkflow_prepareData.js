const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

const allData = {{node:code_node_Pgtw6zFL.data.gdData}};
const pageStatus = {{workflowparams:pageStatus}};
const gdId = allData.id
const pickingNoType = {{node:get_node_zna6o03F.data.data.id}};
const organizationId = allData.organization_id;

const existingTOData = {{node:get_node_EeFMAtLg.data.data}} || null;
const isUpdate = existingTOData && existingTOData.id ? 1 : 0;
const existingTO = isUpdate === 1 ? existingTOData : null;

// Process table items with grouping for serialized items
const pickingItemGroups = new Map();

allData.table_gd.forEach((item, gdLineIndex) => {
  if (item.temp_qty_data && item.material_id) {
    try {
      const tempData = parseJsonSafely(item.temp_qty_data);

      tempData.forEach((tempItem) => {
        const materialId = tempItem.material_id || item.material_id;
        // Group key now includes handling_unit_id so HU and loose allocations
        // for the same line/batch/location become separate picking rows.
        const groupKey = `${materialId}_${tempItem.batch_id || "no-batch"}_${tempItem.location_id}_line${gdLineIndex}_${tempItem.handling_unit_id || "no-hu"}`;

        if (!pickingItemGroups.has(groupKey)) {
          // Create new group
          pickingItemGroups.set(groupKey, {
            item_code: String(materialId),
            item_name: item.material_name,
            item_desc: item.gd_material_desc || "",
            batch_no: tempItem.batch_id ? String(tempItem.batch_id) : null,
            item_batch_id: tempItem.batch_id ? String(tempItem.batch_id) : null,
            qty_to_pick: 0,
            item_uom: String(item.gd_order_uom_id),
            pending_process_qty: 0,
            source_bin: String(tempItem.location_id),
            line_status: "Open",
            so_no: item.line_so_no,
            gd_no: allData.delivery_no,
            so_id: item.line_so_id,
            so_line_id: item.so_line_item_id,
            gd_id: gdId,
            gd_line_id: item.id,
            serial_numbers: [],
            handling_unit_id: tempItem.handling_unit_id ? String(tempItem.handling_unit_id) : null,
          });
        }

        const group = pickingItemGroups.get(groupKey);
        group.qty_to_pick += parseFloat(tempItem.gd_quantity);
        group.pending_process_qty += parseFloat(tempItem.gd_quantity);

        // Add serial number if exists
        if (tempItem.serial_number) {
          group.serial_numbers.push(String(tempItem.serial_number));
        }
      });
    } catch (error) {
      console.error(`Error parsing temp_qty_data: ${error.message}`);
    }
  }
});

// Convert grouped items to picking items array
const tablePickingItems = [];
pickingItemGroups.forEach((group) => {
  // Format serial numbers with comma if any exist
  if (group.serial_numbers.length > 0) {
    group.serial_numbers = group.serial_numbers.join(", ");
    group.is_serialized_item = 1;
  } else {
    delete group.serial_numbers;
    group.is_serialized_item = 0;
  }
  tablePickingItems.push(group);
});

// Cluster HU-allocated rows within each gd_line_id so consecutive HU rows
// can share a single header row inserted below.
tablePickingItems.sort((a, b) => {
  if (a.gd_line_id !== b.gd_line_id) return 0;
  const aHU = a.handling_unit_id || "";
  const bHU = b.handling_unit_id || "";
  if (aHU === bHU) return 0;
  return aHU < bHU ? -1 : 1;
});

// Insert display-only header rows above each consecutive run sharing the
// same handling_unit_id. Item rows are stamped with row_type: "item";
// header rows get row_type: "header" and carry only the HU fields.
const withHeaders = [];
let lastHuId = null;
for (const row of tablePickingItems) {
  const huId = row.handling_unit_id;
  if (huId && huId !== lastHuId) {
    withHeaders.push({
      row_type: "header",
      handling_unit_id: huId,
      hu_select: 0,
    });
    lastHuId = huId;
  } else if (!huId) {
    lastHuId = null;
  }
  withHeaders.push({ ...row, row_type: "item" });
}
tablePickingItems.splice(0, tablePickingItems.length, ...withHeaders);

// Get SO numbers for display
const soNOs = [...new Set(tablePickingItems.map((pi) => pi.so_no).filter(Boolean))];

// Build the transfer order data
const transferOrderData = {
  to_status: "Created",
  to_id: 'issued',
  to_id_type: pickingNoType,
  plant_id: allData.plant_id,
  organization_id: organizationId,
  movement_type: "Picking",
  ref_doc_type: "Goods Delivery",
  gd_no: [gdId],
  delivery_no: allData.delivery_no,
  so_no: soNOs.join(", "),
  customer_id: [allData.customer_name],
  ref_doc: allData.gd_ref_doc,
  assigned_to: allData.assigned_to,
  table_picking_items: tablePickingItems,
  is_deleted: 0,
};

// Notification data
let notificationData = null;
let removedUsers = [];
let addedUsers = [];

if (isUpdate === 1 && existingTO) {
  // Prepare for update
  transferOrderData.updated_by = allData.gd_created_by;
  transferOrderData.updated_at = new Date().toISOString();

  // Determine notification recipients for update
  if (existingTO.assigned_to && allData.assigned_to) {
    const oldAssigned = Array.isArray(existingTO.assigned_to)
      ? existingTO.assigned_to
      : [existingTO.assigned_to];

    const newAssigned = Array.isArray(allData.assigned_to)
      ? allData.assigned_to
      : [allData.assigned_to];

    // Users who were removed
    removedUsers = oldAssigned.filter((userId) => !newAssigned.includes(userId));

    // Users who were added
    addedUsers = newAssigned.filter((userId) => !oldAssigned.includes(userId));
  }
} else {
  // Prepare for create
  transferOrderData.created_by = allData.gd_created_by;
  transferOrderData.created_at = new Date().toISOString().slice(0, 19).replace("T", " ");

  // New assignment notification
  if (allData.assigned_to && allData.assigned_to.length > 0) {
    addedUsers = Array.isArray(allData.assigned_to)
      ? allData.assigned_to
      : [allData.assigned_to];
  }
}

return {
  isUpdate,
  existingTOId: existingTO ? existingTO.id : null,
  existingTONo: existingTO ? existingTO.to_id : null,
  transferOrderData,
  gdId,
  deliveryNo: allData.delivery_no,
  removedUsers,
  addedUsers,
  pickingStatus: "Created",
};
