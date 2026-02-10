const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

const allData = {{workflowparams:allData}};
const pageStatus = {{workflowparams:pageStatus}};
const gdId = {{node:code_node_IyJHrBst.data.gdId}}; // Get from previous code node that has gdId
const pickingNoType = {{node:get_node_zna6o03F.data.data.id}};
const organizationId = allData.organization_id;

// Get existing TO from get-node (will be null/empty if not found)
// Configure get_node_existingTO with:
// - collection: transfer_order
// - where: ref_doc_type = "Goods Delivery", gd_no contains gdId, movement_type = "Picking", is_deleted = 0
const existingTOData = {{node:get_node_existingTO.data.data}};
const isUpdate = existingTOData && existingTOData.id ? true : false;
const existingTO = isUpdate ? existingTOData : null;

// Process table items with grouping for serialized items
const pickingItemGroups = new Map();

allData.table_gd.forEach((item, gdLineIndex) => {
  if (item.temp_qty_data && item.material_id) {
    try {
      const tempData = parseJsonSafely(item.temp_qty_data);

      tempData.forEach((tempItem) => {
        const materialId = tempItem.material_id || item.material_id;
        // Create a grouping key based on item, batch, location, and GD line index to prevent merging separate lines
        const groupKey = `${materialId}_${tempItem.batch_id || "no-batch"}_${tempItem.location_id}_line${gdLineIndex}`;

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

// Get SO numbers for display
const soNOs = [...new Set(tablePickingItems.map((pi) => pi.so_no).filter(Boolean))];

// Build the transfer order data
const transferOrderData = {
  to_status: "Created",
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

if (isUpdate && existingTO) {
  // Prepare for update
  transferOrderData.updated_by = {{$global:nickname}};
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
  transferOrderData.created_by = {{$global:nickname}};
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
