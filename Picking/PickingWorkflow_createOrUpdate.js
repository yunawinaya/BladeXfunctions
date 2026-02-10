// Prepare Create/Update Data - Workflow Code Node
// This node prepares data for the workflow add-node or update-node
//
// NOTE: IDE linter errors are expected - {{}} is workflow template syntax
// that gets replaced at runtime by the workflow engine.
//
// WORKFLOW STRUCTURE AFTER THIS NODE:
// 1. IF node - branch based on isUpdate
//    - true branch: update-node to update existing TO
//    - false branch: add-node to create new TO
// 2. Update GD picking status (update-node)
// 3. Notification workflow or code node

const preparedData = {{node:code_node_o35eZx2c.data}}; // From Prepare Picking Data node
const isUpdate = preparedData.isUpdate;
const transferOrderData = preparedData.transferOrderData;

// For UPDATE operation - prepare update fields
const updateFields = {
  assigned_to: transferOrderData.assigned_to,
  table_picking_items: transferOrderData.table_picking_items,
  updated_by: transferOrderData.updated_by,
  updated_at: transferOrderData.updated_at,
  ref_doc: transferOrderData.ref_doc,
  so_no: transferOrderData.so_no,
  customer_id: transferOrderData.customer_id,
};

// For CREATE operation - use full transferOrderData

// For GD status update
const gdUpdateFields = {
  picking_status: preparedData.pickingStatus,
};

return {
  isUpdate,
  existingTOId: preparedData.existingTOId,
  existingTONo: preparedData.existingTONo,

  // Data for add-node (create new TO)
  createData: transferOrderData,

  // Data for update-node (update existing TO)
  updateData: updateFields,

  // Data for GD status update
  gdId: preparedData.gdId,
  gdUpdateData: gdUpdateFields,

  // Notification data
  deliveryNo: preparedData.deliveryNo,
  removedUsers: preparedData.removedUsers,
  addedUsers: preparedData.addedUsers,
};
