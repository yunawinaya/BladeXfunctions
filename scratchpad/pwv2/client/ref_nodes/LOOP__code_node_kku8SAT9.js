const arrayData = {{workflowparams:arrayData}}
const currentIndexRaw = {{node:get_cache_node_OMu4rhrM.data}}
const index = currentIndexRaw ? parseInt(currentIndexRaw, 10) : 0
const saveAs = {{workflowparams:saveAs}}
const pageStatus = {{workflowparams:pageStatus}}

let data = arrayData[index];
let invalidMessage = "";

// table_putaway_item is a tree: an item bundle is one row with its items under
// `children`. The bundle row holds no stock of its own, so the quantity that
// makes a putaway worth completing can sit on an item under it — walk both.
const flattenPutawayRows = (rows) => {
  const flat = [];

  for (const row of rows || []) {
    flat.push(row);

    const children = Array.isArray(row.children) ? row.children : [];

    for (const child of children) {
      flat.push(child);
    }
  }

  return flat;
};

// Validation: For saveAs "Completed", at least one item must have putaway_qty > 0
if (saveAs === "Completed") {
  const putawayRows = flattenPutawayRows(data.table_putaway_item);
  const hasPutawayQty = putawayRows.length > 0 &&
    putawayRows.some(item => item.putaway_qty > 0);

  if (!hasPutawayQty) {
    invalidMessage = "Cannot complete putaway. At least one item must have putaway quantity greater than 0.";
  }
}

// A Completed save of more than 500 lines is beyond this save (one stock call per line); refused before anything is written
if (saveAs === "Completed" && invalidMessage === "") {
  const lineCount = flattenPutawayRows(data.table_putaway_item).length;
  if (lineCount > 500) {
    invalidMessage = "This putaway has " + lineCount + " lines. Completing more than 500 lines at once is not supported here.";
  }
}

if (saveAs !== "Cancelled") {
  if (saveAs === "Draft") {
    if (
      data.to_id_type !== -9999 &&
      (!data.to_id ||
        data.to_id === null ||
        data.to_id === "")
    ) {
      data.to_id = "draft";
    }
  } else {
    if (
      data.to_id_type !== -9999 &&
      (!data.to_id ||
        data.to_id === null ||
        data.to_id === "" ||
        data.to_status === "Draft")
    ) {
      data.to_id = "issued";
    }
  }
}

let updatedStatus = {{workflowparams:saveAs}}
if (saveAs === "Completed" && pageStatus === "Add") {
  updatedStatus = "Created"
}

// Interpolated into sql_node_LockGate, and arrayData is caller-supplied.
// Putaway ids are snowflake bigints, so digits-only is exact, not a guess;
// "0" matches no row, which fails closed as "under processing".
const lockId = /^[0-9]+$/.test(String(data.id || "")) ? String(data.id) : "0";

return {
  data,
  updatedStatus,
  nextIndex: index + 1,
  invalidMessage,
  lockId,
  isInvalid: invalidMessage === "" ? 0 : 1
}