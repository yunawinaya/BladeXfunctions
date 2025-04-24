const page_status = this.getParamsVariables("page_status");
const self = this;
const stockAdjustmentId = this.getParamsVariables("stock_adjustment_no");

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const logTableState = async (collectionName, queryConditions, logMessage) => {
  try {
    let query = db.collection(collectionName);
    if (queryConditions) {
      query = query.where(queryConditions);
    }
    const response = await query.get();
    const data = Array.isArray(response?.data)
      ? response.data
      : response.data
      ? [response.data]
      : [];
    console.log(`${logMessage}:`, {
      collection: collectionName,
      count: data.length,
      records: data.map((record) => ({
        id: record.id,
        ...record,
      })),
    });
  } catch (error) {
    console.error(`Error logging state for ${collectionName}:`, error);
  }
};

// Function to get latest FIFO cost price with available quantity check
const getLatestFIFOCostPrice = async (materialId, batchId) => {
  try {
    const query = batchId
      ? db
          .collection("fifo_costing_history")
          .where({ material_id: materialId, batch_id: batchId })
      : db
          .collection("fifo_costing_history")
          .where({ material_id: materialId });

    const response = await query.get();
    const result = response.data;

    if (result && Array.isArray(result) && result.length > 0) {
      // Sort by FIFO sequence (lowest/oldest first, as per FIFO principle)
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      // First look for records with available quantity
      for (const record of sortedRecords) {
        const availableQty = parseFloat(record.fifo_available_quantity || 0);
        if (availableQty > 0) {
          console.log(
            `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
          );
          return Number(parseFloat(record.fifo_cost_price || 0).toFixed(4));
        }
      }

      // If no records with available quantity, use the most recent record
      console.warn(
        `No FIFO records with available quantity found for ${materialId}, using most recent cost price`
      );
      return parseFloat(
        sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
      );
    }

    console.warn(`No FIFO records found for material ${materialId}`);
    return 0;
  } catch (error) {
    console.error(`Error retrieving FIFO cost price for ${materialId}:`, error);
    return 0;
  }
};

// Function to get Weighted Average cost price
const getWeightedAverageCostPrice = async (materialId, batchId) => {
  try {
    const query = batchId
      ? db
          .collection("wa_costing_method")
          .where({ material_id: materialId, batch_id: batchId })
      : db.collection("wa_costing_method").where({ material_id: materialId });

    const response = await query.get();
    const waData = response.data;

    if (waData && Array.isArray(waData) && waData.length > 0) {
      // Sort by date (newest first) to get the latest record
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      return Number(parseFloat(waData[0].wa_cost_price || 0).toFixed(4));
    }

    console.warn(
      `No weighted average records found for material ${materialId}`
    );
    return 0;
  } catch (error) {
    console.error(`Error retrieving WA cost price for ${materialId}:`, error);
    return 0;
  }
};

const getFixedCostPrice = async (materialId) => {
  const query = db.collection("Item").where({ id: materialId });
  const response = await query.get();
  const result = response.data;
  return Number(parseFloat(result[0].purchase_unit_price || 0).toFixed(4));
};

const updateInventory = (allData) => {
  const subformData = allData.subform_dus1f9ob;
  const plant_id = allData.plant_id;
  const organization_id = allData.organization_id;
  const adjustment_type = allData.adjustment_type;
  console.log("allData", adjustment_type);

  subformData.forEach((item) => {
    console.log("Processing item:", item.total_quantity);

    db.collection("Item")
      .where({
        id: item.material_id,
      })
      .get()
      .then((response) => {
        const materialData = response.data[0];
        console.log("materialData:", materialData.id);

        const updateQuantities = async (quantityChange, balanceUnitPrice) => {
          try {
            if (!materialData?.id) {
              throw new Error("Invalid material data: material_id is missing");
            }

            if (!materialData.material_costing_method) {
              throw new Error("Material costing method is not defined");
            }

            const costingMethod = materialData.material_costing_method;

            if (
              !["Weighted Average", "First In First Out"].includes(
                costingMethod
              )
            ) {
              throw new Error(`Unsupported costing method: ${costingMethod}`);
            }

            const unitPrice =
              balanceUnitPrice !== undefined
                ? roundPrice(balanceUnitPrice)
                : roundPrice(materialData.purchase_unit_price || 0);
            const batchId =
              materialData.item_batch_management == "1"
                ? item.item_batch_no
                : null;

            if (costingMethod === "Weighted Average") {
              const waQueryConditions =
                materialData.item_batch_management == "1" && batchId
                  ? {
                      material_id: materialData.id,
                      batch_id: batchId,
                      plant_id: plant_id,
                    }
                  : { material_id: materialData.id, plant_id: plant_id };

              await logTableState(
                "wa_costing_method",
                waQueryConditions,
                `Before WA update for material ${materialData.id}`
              );

              const waQuery = db
                .collection("wa_costing_method")
                .where(waQueryConditions);

              const waResponse = await waQuery.get();
              const waData = Array.isArray(waResponse?.data)
                ? waResponse.data
                : [];

              if (waData.length > 0) {
                const latestWa = waData.sort(
                  (a, b) => new Date(b.created_at) - new Date(a.created_at)
                )[0];
                const currentQty = roundQty(latestWa.wa_quantity || 0);
                const currentTotalCost =
                  roundPrice(latestWa.wa_cost_price || 0) * currentQty;

                let newWaQuantity, newWaCostPrice;
                if (quantityChange > 0) {
                  const addedCost = roundPrice(unitPrice * quantityChange);
                  newWaQuantity = roundQty(currentQty + quantityChange);
                  newWaCostPrice =
                    newWaQuantity > 0
                      ? roundPrice(
                          (currentTotalCost + addedCost) / newWaQuantity
                        )
                      : 0;
                } else {
                  newWaQuantity = roundQty(currentQty + quantityChange);
                  newWaCostPrice = latestWa.wa_cost_price
                    ? roundPrice(latestWa.wa_cost_price)
                    : 0;
                }

                if (newWaQuantity < 0) {
                  throw new Error("Insufficient WA quantity");
                }

                await db
                  .collection("wa_costing_method")
                  .doc(latestWa.id)
                  .update({
                    wa_quantity: newWaQuantity,
                    wa_cost_price: newWaCostPrice,
                    updated_at: new Date(),
                  });

                await logTableState(
                  "wa_costing_method",
                  waQueryConditions,
                  `After WA update for material ${materialData.id}`
                );
              } else if (quantityChange > 0) {
                await db.collection("wa_costing_method").add({
                  material_id: materialData.id,
                  batch_id: batchId || null,
                  plant_id: plant_id,
                  organization_id: organization_id,
                  wa_quantity: roundQty(quantityChange),
                  wa_cost_price: roundPrice(unitPrice),
                  created_at: new Date(),
                });

                await logTableState(
                  "wa_costing_method",
                  waQueryConditions,
                  `After adding new WA record for material ${materialData.id}`
                );
              } else {
                throw new Error("No WA costing record found for deduction");
              }
            } else if (costingMethod === "First In First Out") {
              const fifoQueryConditions =
                materialData.item_batch_management == "1" && batchId
                  ? { material_id: materialData.id, batch_id: batchId }
                  : { material_id: materialData.id };

              await logTableState(
                "fifo_costing_history",
                fifoQueryConditions,
                `Before FIFO update for material ${materialData.id}`
              );

              const fifoQuery = db
                .collection("fifo_costing_history")
                .where(fifoQueryConditions);

              const fifoResponse = await fifoQuery.get();
              const fifoData = Array.isArray(fifoResponse?.data)
                ? fifoResponse.data
                : [];
              const lastSequence =
                fifoData.length > 0
                  ? Math.max(
                      ...fifoData.map((record) => record.fifo_sequence || 0)
                    )
                  : 0;
              const newSequence = lastSequence + 1;

              if (quantityChange > 0) {
                await db.collection("fifo_costing_history").add({
                  material_id: materialData.id,
                  batch_id: batchId || null,
                  plant_id: plant_id,
                  organization_id: organization_id,
                  fifo_initial_quantity: roundQty(quantityChange),
                  fifo_available_quantity: roundQty(quantityChange),
                  fifo_cost_price: roundPrice(unitPrice),
                  fifo_sequence: newSequence,
                  created_at: new Date(),
                });

                await logTableState(
                  "fifo_costing_history",
                  fifoQueryConditions,
                  `After adding new FIFO record for material ${materialData.id}`
                );
              } else if (quantityChange < 0) {
                let remainingReduction = roundQty(-quantityChange);

                if (fifoData.length > 0) {
                  // Sort by sequence (oldest first)
                  fifoData.sort((a, b) => a.fifo_sequence - b.fifo_sequence);

                  for (const fifoRecord of fifoData) {
                    if (remainingReduction <= 0) break;

                    const available = roundQty(
                      fifoRecord.fifo_available_quantity || 0
                    );
                    const reduction = roundQty(
                      Math.min(available, remainingReduction)
                    );
                    const newAvailable = roundQty(available - reduction);

                    await db
                      .collection("fifo_costing_history")
                      .doc(fifoRecord.id)
                      .update({
                        fifo_available_quantity: newAvailable,
                        updated_at: new Date(),
                      });

                    remainingReduction = roundQty(
                      remainingReduction - reduction
                    );
                  }

                  if (remainingReduction > 0) {
                    throw new Error(
                      `Insufficient FIFO quantity for material ${
                        materialData.id
                      }. Available: ${roundQty(
                        fifoData.reduce(
                          (sum, record) =>
                            sum + (record.fifo_available_quantity || 0),
                          0
                        )
                      )}, Requested: ${roundQty(-quantityChange)}`
                    );
                  }

                  await logTableState(
                    "fifo_costing_history",
                    fifoQueryConditions,
                    `After FIFO update for material ${materialData.id}`
                  );
                } else {
                  throw new Error(
                    `No FIFO costing records found for deduction for material ${materialData.id}`
                  );
                }
              }
            }
          } catch (error) {
            console.error("Error in updateQuantities:", {
              message: error.message,
              stack: error.stack,
              materialData,
              quantityChange,
              plant_id,
              unitPrice,
              batchId,
            });
            throw new Error(
              `Failed to update costing method: ${
                error.message || "Unknown error"
              }`
            );
          }
        };

        const updateBalance = async (balance) => {
          const categoryMap = {
            Unrestricted: "unrestricted_qty",
            Reserved: "reserved_qty",
            "Quality Inspection": "qualityinsp_qty",
            Blocked: "block_qty",
          };

          const qtyField = categoryMap[balance.category];
          const qtyChange =
            balance.movement_type === "In"
              ? roundQty(balance.sa_quantity)
              : roundQty(-balance.sa_quantity);
          const collectionName =
            materialData.item_batch_management == "1"
              ? "item_batch_balance"
              : "item_balance";

          await logTableState(
            collectionName,
            { material_id: materialData.id, location_id: balance.location_id },
            `Before balance update for material ${materialData.id}, location ${balance.location_id}`
          );

          const balanceQuery = db.collection(collectionName).where({
            material_id: materialData.id,
            location_id: balance.location_id,
            plant_id: plant_id,
          });

          let balanceData = null;
          const response = await balanceQuery.get();
          balanceData = response.data[0];

          if (!balanceData) {
            const initialData = {
              material_id: materialData.id,
              location_id: balance.location_id,
              balance_quantity: 0,
              unrestricted_qty: 0,
              reserved_qty: 0,
              qualityinsp_qty: 0,
              block_qty: 0,
              plant_id: plant_id,
              organization_id: organization_id,
            };
            await db.collection(collectionName).add(initialData);

            await logTableState(
              collectionName,
              {
                material_id: materialData.id,
                location_id: balance.location_id,
              },
              `After adding new balance record for material ${materialData.id}, location ${balance.location_id}`
            );

            const newResponse = await balanceQuery.get();
            balanceData = newResponse.data[0];
          }

          const newBalanceQty = roundQty(
            balanceData.balance_quantity + qtyChange
          );
          const newCategoryQty = roundQty(
            (balanceData[qtyField] || 0) + qtyChange
          );
          console.log("newBalanceQty", newBalanceQty);
          console.log("newCategoryQty", newCategoryQty);
          if (newBalanceQty < 0 || newCategoryQty < 0) {
            throw new Error(
              `Insufficient quantity in ${collectionName} for ${balance.category}`
            );
          }

          const updateData = {
            balance_quantity: newBalanceQty,
            [qtyField]: newCategoryQty,
          };

          await db
            .collection(collectionName)
            .where({
              material_id: materialData.id,
              location_id: balance.location_id,
            })
            .update(updateData);

          await logTableState(
            collectionName,
            { material_id: materialData.id, location_id: balance.location_id },
            `After balance update for material ${materialData.id}, location ${balance.location_id}`
          );

          return balanceData;
        };

        const recordInventoryMovement = async (balance) => {
          const movementType = balance.movement_type === "In" ? "IN" : "OUT";

          await logTableState(
            "inventory_movement",
            { trx_no: allData.adjustment_no, item_id: item.material_id },
            `Before adding inventory movement for adjustment ${allData.adjustment_no}, material ${item.material_id}`
          );

          let unitPrice = roundPrice(balance.unit_price || 0);
          let totalPrice = roundPrice(balance.unit_price * balance.sa_quantity);

          const costingMethod = materialData.material_costing_method;

          if (costingMethod === "First In First Out") {
            // Get unit price from latest FIFO sequence
            const fifoCostPrice = await getLatestFIFOCostPrice(
              item.material_id,
              item.item_batch_no
            );
            unitPrice = roundPrice(fifoCostPrice);
            totalPrice = roundPrice(fifoCostPrice * balance.sa_quantity);
          } else if (costingMethod === "Weighted Average") {
            // Get unit price from WA cost price
            const waCostPrice = await getWeightedAverageCostPrice(
              item.material_id,
              item.item_batch_no
            );
            unitPrice = roundPrice(waCostPrice);
            totalPrice = roundPrice(waCostPrice * balance.sa_quantity);
          } else if (costingMethod === "Fixed Cost") {
            // Get unit price from Fixed Cost
            const fixedCostPrice = await getFixedCostPrice(item.material_id);
            unitPrice = roundPrice(fixedCostPrice);
            totalPrice = roundPrice(fixedCostPrice * balance.sa_quantity);
          } else {
            return Promise.resolve();
          }

          const inventoryMovementData = {
            transaction_type: "SA",
            trx_no: allData.adjustment_no,
            parent_trx_no: null,
            movement: movementType,
            unit_price: unitPrice,
            total_price: totalPrice,
            quantity: roundQty(balance.sa_quantity),
            item_id: item.material_id,
            inventory_category: balance.category,
            uom_id: materialData.based_uom,
            base_qty: roundQty(balance.sa_quantity),
            base_uom_id: materialData.based_uom,
            bin_location_id: balance.location_id,
            batch_number_id:
              materialData.item_batch_management == "1"
                ? item.item_batch_no
                : null,
            costing_method_id: materialData.material_costing_method,
            created_at: new Date(),
            adjustment_type: adjustment_type,
            plant_id: plant_id,
            organization_id: organization_id,
          };

          const invMovementResult = await db
            .collection("inventory_movement")
            .add(inventoryMovementData);
          console.log("Inventory movement recorded:", invMovementResult.id);

          await logTableState(
            "inventory_movement",
            { trx_no: allData.adjustment_no, item_id: item.material_id },
            `After adding inventory movement for adjustment ${allData.adjustment_no}, material ${item.material_id}`
          );

          return invMovementResult;
        };

        if (adjustment_type === "Write Off") {
          // For Write Off, assume unit_price is consistent across balance_index entries
          const balanceUnitPrice =
            item.balance_index && item.balance_index.length > 0
              ? item.balance_index[0].unit_price ||
                materialData.purchase_unit_price ||
                0
              : materialData.purchase_unit_price || 0;

          return updateQuantities(-item.total_quantity, balanceUnitPrice)
            .then(() => {
              if (item.balance_index && Array.isArray(item.balance_index)) {
                return Promise.all(
                  item.balance_index
                    .filter((balance) => balance.sa_quantity > 0)
                    .map((balance) =>
                      Promise.all([
                        updateBalance(balance),
                        recordInventoryMovement(balance),
                      ])
                    )
                );
              }
              return null;
            })
            .then((responses) => {
              if (responses) {
                console.log("Write Off update responses:", responses);
              }
            })
            .catch((error) => {
              console.error("Error in Write Off processing:", error);
              throw error;
            });
        } else if (adjustment_type === "Stock Count") {
          let netQuantityChange = 0;
          let totalInCost = 0;
          let totalInQuantity = 0;

          if (item.balance_index && Array.isArray(item.balance_index)) {
            item.balance_index.forEach((balance) => {
              if (balance.movement_type === "In") {
                netQuantityChange += balance.sa_quantity;
                totalInCost += (balance.unit_price || 0) * balance.sa_quantity;
                totalInQuantity += balance.sa_quantity;
              } else if (balance.movement_type === "Out") {
                netQuantityChange -= balance.sa_quantity;
              }
            });
          }

          // Calculate weighted average unit price for "In" movements
          const balanceUnitPrice =
            totalInQuantity > 0
              ? totalInCost / totalInQuantity
              : materialData.purchase_unit_price || 0;

          return updateQuantities(netQuantityChange, balanceUnitPrice)
            .then(() => {
              if (item.balance_index && Array.isArray(item.balance_index)) {
                return Promise.all(
                  item.balance_index
                    .filter((balance) => balance.sa_quantity > 0)
                    .map((balance) =>
                      Promise.all([
                        updateBalance(balance),
                        recordInventoryMovement(balance),
                      ])
                    )
                );
              }
              return null;
            })
            .then((responses) => {
              if (responses) {
                console.log("Stock Count update responses:", responses);
              }
            })
            .catch((error) => {
              console.error("Error in Stock Count processing:", error);
              throw error;
            });
        }
        return Promise.resolve(null);
      })
      .catch((error) => {
        console.error(
          "Error fetching item data or processing adjustment:",
          error
        );
      });
  });
};

async function preCheckQuantitiesAndCosting(allData, context) {
  try {
    console.log("Starting preCheckQuantitiesAndCosting with data:", allData);

    // Step 3: Perform item validations and quantity checks
    for (const item of allData.subform_dus1f9ob) {
      // Fetch material data
      const materialResponse = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();
      const materialData = materialResponse.data[0];
      if (!materialData) {
        throw new Error(`Material not found: ${item.material_id}`);
      }
      if (!materialData.material_costing_method) {
        throw new Error(
          `Costing method not defined for item ${item.material_id}`
        );
      }

      const balancesToProcess =
        item.balance_index?.filter(
          (balance) => balance.sa_quantity && balance.sa_quantity > 0
        ) || [];

      const adjustment_type = allData.adjustment_type;
      const batchId =
        materialData.item_batch_management == "1" ? item.item_batch_no : null;
      const plant_id = allData.plant_id;

      // Step 4: Check quantities for Write Off or Stock Count (Out movements)
      if (
        adjustment_type === "Write Off" ||
        (adjustment_type === "Stock Count" && item.total_quantity < 0)
      ) {
        const requestedQty = Math.abs(item.total_quantity);

        // Check balance quantities
        for (const balance of balancesToProcess) {
          const collectionName =
            materialData.item_batch_management == "1"
              ? "item_batch_balance"
              : "item_balance";
          const balanceQuery = db.collection(collectionName).where({
            material_id: materialData.id,
            location_id: balance.location_id,
            plant_id: plant_id,
          });
          const balanceResponse = await balanceQuery.get();
          const balanceData = balanceResponse.data[0];

          if (!balanceData) {
            throw new Error(
              `No existing balance found for item ${item.material_id} at location ${balance.location_id}`
            );
          }

          const categoryMap = {
            Unrestricted: "unrestricted_qty",
            Reserved: "reserved_qty",
            "Quality Inspection": "qualityinsp_qty",
            Blocked: "block_qty",
          };
          const categoryField = categoryMap[balance.category || "Unrestricted"];
          const currentQty = balanceData[categoryField] || 0;

          if (currentQty < balance.sa_quantity) {
            throw new Error(
              `Insufficient quantity in ${
                balance.category || "Unrestricted"
              } for item ${item.material_id} at location ${
                balance.location_id
              }. Available: ${currentQty}, Requested: ${balance.sa_quantity}`
            );
          }
        }

        // Step 5: Check costing records
        const costingMethod = materialData.material_costing_method;

        if (costingMethod === "Weighted Average") {
          const waQueryConditions =
            materialData.item_batch_management == "1" && batchId
              ? {
                  material_id: materialData.id,
                  batch_id: batchId,
                  plant_id: plant_id,
                }
              : { material_id: materialData.id, plant_id: plant_id };

          const waQuery = db
            .collection("wa_costing_method")
            .where(waQueryConditions);
          const waResponse = await waQuery.get();
          const waData = Array.isArray(waResponse?.data) ? waResponse.data : [];

          if (waData.length === 0) {
            throw new Error(
              `No costing record found for deduction for item ${item.material_id} (Weighted Average)`
            );
          }

          const latestWa = waData.sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
          )[0];
          const currentQty = latestWa.wa_quantity || 0;

          if (currentQty < requestedQty) {
            throw new Error(
              `Insufficient WA quantity for item ${item.material_id}. Available: ${currentQty}, Requested: ${requestedQty}`
            );
          }
        } else if (costingMethod === "First In First Out") {
          const fifoQueryConditions =
            materialData.item_batch_management == "1" && batchId
              ? { material_id: materialData.id, batch_id: batchId }
              : { material_id: materialData.id };

          const fifoQuery = db
            .collection("fifo_costing_history")
            .where(fifoQueryConditions);
          const fifoResponse = await fifoQuery.get();
          const fifoData = Array.isArray(fifoResponse?.data)
            ? fifoResponse.data
            : [];

          if (fifoData.length === 0) {
            throw new Error(
              `No costing record found for deduction for item ${item.material_id} (FIFO)`
            );
          }

          const totalAvailable = fifoData.reduce(
            (sum, record) => sum + (record.fifo_available_quantity || 0),
            0
          );
          if (totalAvailable < requestedQty) {
            throw new Error(
              `Insufficient FIFO quantity for item ${item.material_id}. Available: ${totalAvailable}, Requested: ${requestedQty}`
            );
          }
        }
      }
    }

    // Step 6: If all checks pass, show confirmation popup
    return true;
  } catch (error) {
    console.error("Error in preCheckQuantitiesAndCosting:", error.message);
    if (context && context.parentGenerateForm) {
      context.parentGenerateForm.$alert(error.message, "Validation Error", {
        confirmButtonText: "OK",
        type: "error",
      });
    } else {
      alert(error.message);
    }
    throw error;
  }
}

if (page_status === "Add") {
  this.showLoading();
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  self
    .getData()
    .then((allData) => {
      // Pre-check quantities and costing
      preCheckQuantitiesAndCosting(allData, self)
        .then(() => {
          console.log("allData", allData);
          const tableIndex = allData.dialog_index?.table_index;
          const adjustedBy = allData.adjusted_by || "system";
          const {
            organization_id,
            adjustment_date,
            adjustment_type,
            plant_id,
            adjustment_no,
            adjustment_remarks,
            reference_documents,
            subform_dus1f9ob,
          } = allData;

          const sa = {
            stock_adjustment_status: "Completed",
            posted_status: "Pending Post",
            organization_id,
            adjustment_no,
            adjustment_date,
            adjustment_type,
            adjusted_by: adjustedBy,
            plant_id,
            adjustment_remarks,
            reference_documents,
            subform_dus1f9ob,
            table_index: tableIndex,
          };

          return db
            .collection("stock_adjustment")
            .add(sa)
            .then(() => {
              updateInventory(sa);
            });
        })
        .then(() => {
          this.runWorkflow(
            "1909088441531375617",
            { key: "value" },
            (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              console.error("失败结果：", err);
            }
          );
        })
        .then(() => {
          return db
            .collection("prefix_configuration")
            .where({
              document_types: "Stock Adjustment",
              is_deleted: 0,
              organization_id: organizationId,
              is_active: 1,
            })
            .get()
            .then((prefixEntry) => {
              if (prefixEntry.data.length === 0) return;
              else {
                const data = prefixEntry.data[0];
                return db
                  .collection("prefix_configuration")
                  .where({
                    document_types: "Stock Adjustment",
                    is_deleted: 0,
                    organization_id: organizationId,
                  })
                  .update({
                    running_number: parseInt(data.running_number) + 1,
                    has_record: 1,
                  });
              }
            });
        })
        .then(() => {
          closeDialog();
        })
        .catch((error) => {
          console.error("Error in stock adjustment:", error);
          // Error already handled in preCheckQuantitiesAndCosting
        });
    })
    .catch((error) => {
      self.$alert(error, "Error", {
        confirmButtonText: "OK",
        type: "error",
      });
    });
} else if (page_status === "Edit") {
  this.showLoading();
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  this.getData().then((allData) => {
    // Pre-check quantities and costing
    preCheckQuantitiesAndCosting(allData, self)
      .then(() => {
        const tableIndex = allData.dialog_index?.table_index;
        const adjustedBy = allData.adjusted_by || "system";
        const {
          adjustment_no,
          organization_id,
          adjustment_date,
          adjustment_type,
          plant_id,
          adjustment_remarks,
          reference_documents,
          subform_dus1f9ob,
        } = allData;

        const sa = {
          stock_adjustment_status: "Completed",
          posted_status: "Pending Post",
          organization_id,
          adjustment_no,
          adjustment_date,
          adjustment_type,
          adjusted_by: adjustedBy,
          plant_id,
          adjustment_remarks,
          reference_documents,
          subform_dus1f9ob,
          table_index: tableIndex,
        };

        const prefixEntry = db
          .collection("prefix_configuration")
          .where({
            document_types: "Stock Adjustment",
            is_deleted: 0,
            organization_id: organizationId,
            is_active: 1,
          })
          .get()
          .then((prefixEntry) => {
            if (prefixEntry.data.length > 0) {
              const prefixData = prefixEntry.data[0];
              const now = new Date();
              let prefixToShow;
              let runningNumber = prefixData.running_number;
              let isUnique = false;
              let maxAttempts = 10;
              let attempts = 0;

              const generatePrefix = (runNumber) => {
                let generated = prefixData.current_prefix_config;
                generated = generated.replace(
                  "prefix",
                  prefixData.prefix_value
                );
                generated = generated.replace(
                  "suffix",
                  prefixData.suffix_value
                );
                generated = generated.replace(
                  "month",
                  String(now.getMonth() + 1).padStart(2, "0")
                );
                generated = generated.replace(
                  "day",
                  String(now.getDate()).padStart(2, "0")
                );
                generated = generated.replace("year", now.getFullYear());
                generated = generated.replace(
                  "running_number",
                  String(runNumber).padStart(prefixData.padding_zeroes, "0")
                );
                return generated;
              };

              const checkUniqueness = async (generatedPrefix) => {
                const existingDoc = await db
                  .collection("stock_adjustment")
                  .where({ adjustment_no: generatedPrefix })
                  .get();
                return existingDoc.data[0] ? false : true;
              };

              const findUniquePrefix = async () => {
                while (!isUnique && attempts < maxAttempts) {
                  attempts++;
                  prefixToShow = generatePrefix(runningNumber);
                  isUnique = await checkUniqueness(prefixToShow);
                  if (!isUnique) {
                    runningNumber++;
                  }
                }

                if (!isUnique) {
                  throw new Error(
                    "Could not generate a unique Stock Adjustment number after maximum attempts"
                  );
                } else {
                  sa.adjustment_no = prefixToShow;
                  db.collection("stock_adjustment")
                    .doc(stockAdjustmentId)
                    .update(sa)
                    .then(() => {
                      updateInventory(sa);
                    });
                  db.collection("prefix_configuration")
                    .where({
                      document_types: "Stock Adjustment",
                      is_deleted: 0,
                      organization_id: organizationId,
                    })
                    .update({
                      running_number: parseInt(runningNumber) + 1,
                      has_record: 1,
                    });
                }
              };

              findUniquePrefix();
            } else {
              db.collection("stock_adjustment")
                .doc(stockAdjustmentId)
                .update(sa)
                .then(() => {
                  updateInventory(sa);
                });
            }
          })
          .then(() => {
            this.runWorkflow(
              "1909088441531375617",
              { key: "value" },
              (res) => {
                console.log("成功结果：", res);
              },
              (err) => {
                console.error("失败结果：", err);
              }
            );
          })
          .then(() => {
            closeDialog();
          })
          .catch((error) => {
            console.error("Error updating stock adjustment:", error);
            self.$alert(
              "Please fill in all required fields marked with (*) before submitting.",
              "Error",
              {
                confirmButtonText: "OK",
                type: "error",
              }
            );
          });
      })
      .catch((error) => {
        // Error already handled in preCheckQuantitiesAndCosting
        console.error("Error in pre-check:", error);
      });
  });
}
