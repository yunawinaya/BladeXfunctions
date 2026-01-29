const costingMethod = "{{node:code_node_wBfvXM2G.data.costingMethod}}";
const fifoData = "{{node:search_node_L50IlXls.data.data}}";
const waData = "{{node:search_node_FGjULf7c.data.data}}";
const plantId = "{{workflowparams:plant_id}}";
const organizationId = "{{workflowparams:organization_id}}";
const materialId = "{{workflowparams:material_id}}";

/**
 * Migrate inventory costing method between FIFO and Weighted Average
 *
 * @param {string} costingMethod - Target method: "First In First Out" or "Weighted Average"
 * @param {Array} fifoData - Array of existing FIFO costing records
 * @param {Array} waData - Array of existing WA costing records
 * @param {string} plantId - Plant identifier
 * @param {string} organizationId - Organization identifier
 * @param {string} materialId - Material/Item identifier
 *
 * @returns {Object} Result object with:
 *   - success: boolean
 *   - action: "add" | "update" | null
 *   - recordToAdd: object (if action is "add")
 *   - recordToUpdate: { id, data } (if action is "update")
 *   - idsToDelete: array of record IDs from incorrect costing method
 *   - errors: array of error messages (if any)
 */
const migrateCosting = async () => {
  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  const roundQty = (value) => parseFloat(parseFloat(value || 0).toFixed(3));
  const roundPrice = (value) => parseFloat(parseFloat(value || 0).toFixed(4));

  // ============================================================================
  // VALIDATION
  // ============================================================================

  const validMethods = ["First In First Out", "Weighted Average"];
  if (!validMethods.includes(costingMethod)) {
    return {
      success: false,
      action: null,
      recordToAdd: null,
      recordToUpdate: null,
      idsToDelete: [],
      errors: [
        `Invalid costing method: ${costingMethod}. Valid options: ${validMethods.join(", ")}`,
      ],
    };
  }

  if (!plantId || !organizationId || !materialId) {
    return {
      success: false,
      action: null,
      recordToAdd: null,
      recordToUpdate: null,
      idsToDelete: [],
      errors: ["plantId, organizationId, and materialId are required"],
    };
  }

  // ============================================================================
  // PARSE DATA
  // ============================================================================

  const fifoRecords = Array.isArray(fifoData) ? fifoData : [];
  const waRecords = Array.isArray(waData) ? waData : [];

  try {
    // ============================================================================
    // TARGET: Weighted Average
    // ============================================================================

    if (costingMethod === "Weighted Average") {
      // Collect IDs from FIFO records to delete (incorrect data)
      const idsToDelete = fifoRecords
        .filter((r) => r.id)
        .map((r) => r.id);

      // Calculate total quantity and weighted cost from FIFO records
      let totalQuantity = 0;
      let totalCostValue = 0;

      for (const record of fifoRecords) {
        const qty = roundQty(record.fifo_available_quantity);
        if (qty > 0) {
          const price = roundPrice(record.fifo_cost_price);
          totalQuantity = roundQty(totalQuantity + qty);
          totalCostValue = roundPrice(totalCostValue + qty * price);
        }
      }

      // Calculate weighted average cost from FIFO data
      const fifoWeightedAvgCost =
        totalQuantity > 0 ? roundPrice(totalCostValue / totalQuantity) : 0;

      // Check if WA record already exists
      if (waRecords.length > 0) {
        // UPDATE existing WA record - merge FIFO data into existing WA
        const existingWa = waRecords[0];
        const existingWaQty = roundQty(existingWa.wa_quantity);
        const existingWaCost = roundPrice(existingWa.wa_cost_price);

        // Calculate new weighted average combining existing WA + migrated FIFO
        const newTotalQty = roundQty(existingWaQty + totalQuantity);
        const newWaCost =
          newTotalQty > 0
            ? roundPrice(
                (existingWaCost * existingWaQty +
                  fifoWeightedAvgCost * totalQuantity) /
                  newTotalQty
              )
            : existingWaCost;

        return {
          success: true,
          action: "update",
          recordToAdd: null,
          recordToUpdate: {
            id: existingWa.id,
            data: {
              wa_quantity: newTotalQty,
              wa_cost_price: newWaCost,
              updated_at: new Date(),
            },
          },
          idsToDelete: idsToDelete,
          errors: [],
        };
      } else {
        // ADD new WA record
        if (totalQuantity <= 0) {
          return {
            success: false,
            action: null,
            recordToAdd: null,
            recordToUpdate: null,
            idsToDelete: idsToDelete,
            errors: ["No quantity to migrate from FIFO to Weighted Average"],
          };
        }

        return {
          success: true,
          action: "add",
          recordToAdd: {
            material_id: materialId,
            plant_id: plantId,
            organization_id: organizationId,
            wa_quantity: totalQuantity,
            wa_cost_price: fifoWeightedAvgCost,
            created_at: new Date(),
            updated_at: new Date(),
          },
          recordToUpdate: null,
          idsToDelete: idsToDelete,
          errors: [],
        };
      }
    }

    // ============================================================================
    // TARGET: First In First Out
    // ============================================================================

    if (costingMethod === "First In First Out") {
      // Collect IDs from WA records to delete (incorrect data)
      const idsToDelete = waRecords
        .filter((r) => r.id)
        .map((r) => r.id);

      // Get quantity and cost from WA records
      let waQuantity = 0;
      let waCostPrice = 0;

      if (waRecords.length > 0) {
        // Use the most recent WA record
        const sortedWa = waRecords.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
          const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
          return dateB - dateA;
        });
        waQuantity = roundQty(sortedWa[0].wa_quantity);
        waCostPrice = roundPrice(sortedWa[0].wa_cost_price);
      }

      // Check if FIFO records already exist
      if (fifoRecords.length > 0) {
        // FIFO already exists - ADD new layer with next sequence
        const maxSequence = Math.max(
          ...fifoRecords.map((r) => parseInt(r.fifo_sequence || 0, 10)),
          0
        );

        if (waQuantity <= 0) {
          return {
            success: false,
            action: null,
            recordToAdd: null,
            recordToUpdate: null,
            idsToDelete: idsToDelete,
            errors: ["No quantity to migrate from Weighted Average to FIFO"],
          };
        }

        return {
          success: true,
          action: "add",
          recordToAdd: {
            material_id: materialId,
            plant_id: plantId,
            organization_id: organizationId,
            fifo_sequence: maxSequence + 1,
            fifo_cost_price: waCostPrice,
            fifo_initial_quantity: waQuantity,
            fifo_available_quantity: waQuantity,
            created_at: new Date(),
            updated_at: new Date(),
          },
          recordToUpdate: null,
          idsToDelete: idsToDelete,
          errors: [],
        };
      } else {
        // ADD new FIFO record (first layer)
        if (waQuantity <= 0) {
          return {
            success: false,
            action: null,
            recordToAdd: null,
            recordToUpdate: null,
            idsToDelete: idsToDelete,
            errors: ["No quantity to migrate from Weighted Average to FIFO"],
          };
        }

        return {
          success: true,
          action: "add",
          recordToAdd: {
            material_id: materialId,
            plant_id: plantId,
            organization_id: organizationId,
            fifo_sequence: 1,
            fifo_cost_price: waCostPrice,
            fifo_initial_quantity: waQuantity,
            fifo_available_quantity: waQuantity,
            created_at: new Date(),
            updated_at: new Date(),
          },
          recordToUpdate: null,
          idsToDelete: idsToDelete,
          errors: [],
        };
      }
    }

    return {
      success: false,
      action: null,
      recordToAdd: null,
      recordToUpdate: null,
      idsToDelete: [],
      errors: ["Unknown error occurred"],
    };
  } catch (error) {
    console.error("Migration failed with error:", error);
    return {
      success: false,
      action: null,
      recordToAdd: null,
      recordToUpdate: null,
      idsToDelete: [],
      errors: [`Critical error: ${error.message}`],
    };
  }
};

const result = await migrateCosting();
