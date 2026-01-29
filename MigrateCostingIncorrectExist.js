const costingMethod = "{{node:code_node_wBfvXM2G.data.costingMethod}}";
const fifoData = "{{node:search_node_L50IlXls.data.data}}";
const waData = "{{node:search_node_FGjULf7c.data.data}}";
const plantId = "{{workflowparams:plant_id}}";
const organizationId = "{{workflowparams:organization_id}}";
const materialId = "{{workflowparams:material_id}}";
const batchId = "{{workflowparams:batch_id}}";

/**
 * Scenario: Data exists in incorrect costing method collection
 * Convert data to correct costing method
 */
const roundQty = (value) => parseFloat(parseFloat(value || 0).toFixed(3));
const roundPrice = (value) => parseFloat(parseFloat(value || 0).toFixed(4));

const fifoRecords = Array.isArray(fifoData) ? fifoData : [];
const waRecords = Array.isArray(waData) ? waData : [];

// TARGET: Weighted Average - convert FIFO to WA
if (costingMethod === "Weighted Average") {
  const idsToDelete = fifoRecords.filter((r) => r.id).map((r) => r.id);

  let totalQty = 0;
  let totalCost = 0;
  for (const record of fifoRecords) {
    const qty = roundQty(record.fifo_available_quantity);
    if (qty > 0) {
      const price = roundPrice(record.fifo_cost_price);
      totalQty = roundQty(totalQty + qty);
      totalCost = roundPrice(totalCost + qty * price);
    }
  }
  const weightedAvgCost = totalQty > 0 ? roundPrice(totalCost / totalQty) : 0;

  const targetRecord = {
    material_id: materialId,
    plant_id: plantId,
    organization_id: organizationId,
    wa_quantity: totalQty,
    wa_cost_price: weightedAvgCost,
    batch_id: null,
    created_at: new Date(),
  };

  if (batchId) {
    targetRecord.batch_id = batchId;
  }

  return {
    targetRecord: targetRecord,
    idsToDelete: idsToDelete,
    targetCosting: "WA",
  };
}

// TARGET: FIFO - convert WA to FIFO
if (costingMethod === "First In First Out") {
  const idsToDelete = waRecords.filter((r) => r.id).map((r) => r.id);

  const sortedWa = waRecords.sort((a, b) => {
    const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
    const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
    return dateB - dateA;
  });
  const waQty = roundQty(sortedWa[0].wa_quantity);
  const waCost = roundPrice(sortedWa[0].wa_cost_price);

  const targetRecord = {
    material_id: materialId,
    plant_id: plantId,
    organization_id: organizationId,
    fifo_sequence: 1,
    fifo_cost_price: waCost,
    fifo_initial_quantity: waQty,
    fifo_available_quantity: waQty,
    batch_id: null,
    created_at: new Date(),
  };

  if (batchId) {
    targetRecord.batch_id = batchId;
  }

  return {
    targetRecord: targetRecord,
    idsToDelete: idsToDelete,
    targetCosting: "FIFO",
  };
}

return {
  targetRecord: null,
  idsToDelete: [],
  targetCosting: null,
};
