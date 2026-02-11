const record = {{node:get_node_vUhN5jO6.data.data}};
const releasedQty = {{workflowparams:released_qty}};

// Validate input
if (!record || !record.id) {
  return {
    code: "400",
    message: "No reserved data found",
    recordsToUpdate: [],
    recordsToUpdateLength: 0,
    recordToCreate: null,
    recordToCreateExists: 0,
  };
}

// Validate qty
if (releasedQty <= 0) {
  return {
    code: "400",
    message: "Release qty must be greater than 0",
    recordsToUpdate: [],
    recordsToUpdateLength: 0,
    recordToCreate: null,
    recordToCreateExists: 0,
  };
}

if (releasedQty > record.reserved_qty) {
  return {
    code: "400",
    message: "Release qty cannot exceed reserved qty",
    recordsToUpdate: [],
    recordsToUpdateLength: 0,
    recordToCreate: null,
    recordToCreateExists: 0,
  };
}

const recordsToUpdate = [];
let recordToCreate = null;

const remainingQty = record.reserved_qty - releasedQty;

// Update original record to Cancelled with released qty
recordsToUpdate.push({
  ...record,
  reserved_qty: releasedQty,
  open_qty: 0,
  status: "Cancelled",
});

// Create new Pending with remaining qty (if any)
if (remainingQty > 0) {
  const { _id, id, ...recordWithoutId } = record;
  recordToCreate = {
    ...recordWithoutId,
    doc_id: "",
    doc_no: "",
    doc_line_id: "",
    reserved_qty: remainingQty,
    open_qty: remainingQty,
    status: "Pending",
    target_gd_id: null,
  };
}

const transactionType = record.doc_type === "Sales Order" ? "SO" : "PROGRESS";

return {
  code: "200",
  recordsToUpdate,
  recordsToUpdateLength: recordsToUpdate.length,
  recordToCreate,
  recordToCreateExists: recordToCreate ? 1 : 0,
  message: `Released ${releasedQty} from pending. ${remainingQty > 0 ? `Created new pending with ${remainingQty}` : "No remaining qty."}`,
  transactionType
};
