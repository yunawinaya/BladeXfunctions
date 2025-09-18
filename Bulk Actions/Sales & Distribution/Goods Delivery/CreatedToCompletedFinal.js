const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

// Helper function to safely parse JSON
const parseJsonSafely = (jsonString, defaultValue = []) => {
  try {
    return jsonString ? JSON.parse(jsonString) : defaultValue;
  } catch (error) {
    console.error("JSON parse error:", error);
    return defaultValue;
  }
};

// Comprehensive bulk inventory validation for all selected GDs
const validateBulkInventoryAvailability = async (goodsDeliveryData) => {
  console.log("Starting bulk inventory validation for all selected GDs");

  const allValidationErrors = [];

  for (const gdItem of goodsDeliveryData) {
    console.log(`Validating inventory for GD: ${gdItem.delivery_no}`);

    const items = gdItem.table_gd;
    if (!Array.isArray(items) || items.length === 0) {
      continue;
    }

    // Create a map to track total required quantities using pipe separator for keys
    const requiredQuantities = new Map();

    // First pass: Calculate total required quantities for this GD
    for (const item of items) {
      if (!item.material_id || !item.temp_qty_data) {
        continue;
      }

      try {
        // Get item data to check stock control, serialization, and UOM conversion
        const itemRes = await db
          .collection("Item")
          .where({ id: item.material_id })
          .get();

        if (!itemRes.data || !itemRes.data.length) {
          allValidationErrors.push({
            gdNo: gdItem.delivery_no,
            error: `Item not found: ${item.material_id}`,
          });
          continue;
        }

        const itemData = itemRes.data[0];

        // Skip if stock control is disabled
        if (itemData.stock_control === 0) {
          continue;
        }

        const isSerializedItem = itemData.serial_number_management === 1;
        const isBatchManagedItem = itemData.item_batch_management === 1;
        const temporaryData = parseJsonSafely(item.temp_qty_data);

        for (const temp of temporaryData) {
          // Calculate base quantity with UOM conversion
          let baseQty = roundQty(temp.gd_quantity);

          if (
            Array.isArray(itemData.table_uom_conversion) &&
            itemData.table_uom_conversion.length > 0
          ) {
            const uomConversion = itemData.table_uom_conversion.find(
              (conv) => conv.alt_uom_id === item.gd_order_uom_id
            );

            if (uomConversion) {
              baseQty = roundQty(baseQty * uomConversion.base_qty);
            }
          }

          // Create unique key using pipe separator to avoid conflicts with hyphens in serial numbers
          let key;
          if (isSerializedItem) {
            if (isBatchManagedItem && temp.batch_id) {
              key = `${item.material_id}|${temp.location_id || "no-location"}|${
                temp.batch_id
              }|${temp.serial_number}`;
            } else {
              key = `${item.material_id}|${temp.location_id || "no-location"}|${
                temp.serial_number
              }`;
            }
          } else {
            key = temp.batch_id
              ? `${item.material_id}|${temp.location_id}|${temp.batch_id}`
              : `${item.material_id}|${temp.location_id}`;
          }

          // Add to required quantities
          const currentRequired = requiredQuantities.get(key) || 0;
          requiredQuantities.set(key, currentRequired + baseQty);
        }
      } catch (error) {
        console.error(`Error processing item ${item.material_id}:`, error);
        allValidationErrors.push({
          gdNo: gdItem.delivery_no,
          error: `Error processing item ${item.material_id}: ${error.message}`,
        });
        continue;
      }
    }

    // Second pass: Check availability against current balances for this GD
    for (const [key, requiredQty] of requiredQuantities.entries()) {
      const keyParts = key.split("|");
      const materialId = keyParts[0];
      const locationId = keyParts[1] !== "no-location" ? keyParts[1] : null;

      let batchId, serialNumber;

      // Determine if this is a serialized item key
      const itemRes = await db
        .collection("Item")
        .where({ id: materialId })
        .get();
      if (!itemRes.data || !itemRes.data.length) {
        continue;
      }

      const itemData = itemRes.data[0];
      const isSerializedItem = itemData.serial_number_management === 1;
      const isBatchManagedItem = itemData.item_batch_management === 1;

      if (isSerializedItem) {
        if (isBatchManagedItem) {
          // serialized + batch: materialId|locationId|batchId|serialNumber
          batchId = keyParts[2] !== "undefined" ? keyParts[2] : null;
          serialNumber = keyParts[3];
        } else {
          // serialized only: materialId|locationId|serialNumber
          serialNumber = keyParts[2];
          batchId = null;
        }
      } else {
        // non-serialized: materialId|locationId|batchId (or no batchId)
        batchId = keyParts[2] !== "undefined" ? keyParts[2] : null;
        serialNumber = null;
      }

      try {
        let totalAvailableQty = 0;

        if (isSerializedItem) {
          // FOR SERIALIZED ITEMS: Check item_serial_balance
          const itemBalanceParams = {
            material_id: materialId,
            serial_number: serialNumber,
            plant_id: gdItem.plant_id.id,
            organization_id: gdItem.organization_id,
          };

          if (locationId) {
            itemBalanceParams.location_id = locationId;
          }

          if (batchId && batchId !== "undefined") {
            itemBalanceParams.batch_id = batchId;
          }

          const balanceQuery = await db
            .collection("item_serial_balance")
            .where(itemBalanceParams)
            .get();

          if (balanceQuery.data && balanceQuery.data.length > 0) {
            const balance = balanceQuery.data[0];
            const unrestrictedQty = roundQty(
              parseFloat(balance.unrestricted_qty || 0)
            );
            const reservedQty = roundQty(parseFloat(balance.reserved_qty || 0));

            // For Completed status, both unrestricted and reserved can be used
            totalAvailableQty = roundQty(unrestrictedQty + reservedQty);

            console.log(
              `Serialized item ${materialId}, serial ${serialNumber}: Unrestricted=${unrestrictedQty}, Reserved=${reservedQty}, Total=${totalAvailableQty}`
            );
          }
        } else {
          // FOR NON-SERIALIZED ITEMS: Use existing logic
          const itemBalanceParams = {
            material_id: materialId,
            plant_id: gdItem.plant_id.id,
            organization_id: gdItem.organization_id,
          };

          if (locationId) {
            itemBalanceParams.location_id = locationId;
          }

          if (batchId && batchId !== "undefined") {
            itemBalanceParams.batch_id = batchId;
          }

          const balanceCollection =
            batchId && batchId !== "undefined"
              ? "item_batch_balance"
              : "item_balance";

          const balanceQuery = await db
            .collection(balanceCollection)
            .where(itemBalanceParams)
            .get();

          if (balanceQuery.data && balanceQuery.data.length > 0) {
            const balance = balanceQuery.data[0];
            const unrestrictedQty = roundQty(
              parseFloat(balance.unrestricted_qty || 0)
            );
            const reservedQty = roundQty(parseFloat(balance.reserved_qty || 0));

            // For Completed status, both unrestricted and reserved can be used
            totalAvailableQty = roundQty(unrestrictedQty + reservedQty);

            console.log(
              `Item ${materialId} at ${locationId}: Unrestricted=${unrestrictedQty}, Reserved=${reservedQty}, Total=${totalAvailableQty}`
            );
          }
        }

        if (totalAvailableQty < requiredQty) {
          // Get item name for better error message
          const itemName = itemData.material_name || materialId;

          let errorMsg = `Insufficient total inventory for item "${itemName}". `;
          errorMsg += `Required: ${requiredQty}, Available: ${totalAvailableQty}`;

          if (isSerializedItem && serialNumber) {
            errorMsg += `, Serial: "${serialNumber}"`;
          }

          if (locationId && !isSerializedItem) {
            try {
              const locationRes = await db
                .collection("bin_location")
                .where({ id: locationId })
                .get();

              const locationName =
                locationRes.data && locationRes.data.length > 0
                  ? locationRes.data[0].bin_location_combine || locationId
                  : locationId;

              errorMsg += `, Location: "${locationName}"`;
            } catch {
              errorMsg += `, Location: "${locationId}"`;
            }
          }

          if (batchId && batchId !== "undefined") {
            try {
              const batchRes = await db
                .collection("batch")
                .where({ id: batchId })
                .get();

              const batchName =
                batchRes.data && batchRes.data.length > 0
                  ? batchRes.data[0].batch_number || batchId
                  : batchId;

              errorMsg += `, Batch: "${batchName}"`;
            } catch {
              errorMsg += `, Batch: "${batchId}"`;
            }
          }

          allValidationErrors.push({
            gdNo: gdItem.delivery_no,
            error: errorMsg,
            details: {
              materialId,
              itemName,
              locationId: locationId || null,
              batchId: batchId !== "undefined" ? batchId : null,
              serialNumber: serialNumber || null,
              requiredQty,
              totalAvailableQty,
            },
          });
        }
      } catch (error) {
        console.error(`Error checking balance for ${key}:`, error);
        allValidationErrors.push({
          gdNo: gdItem.delivery_no,
          error: `Error checking inventory balance: ${error.message}`,
        });
      }
    }
  }

  if (allValidationErrors.length > 0) {
    console.log(
      "Bulk inventory validation failed with errors:",
      allValidationErrors
    );
    return {
      isValid: false,
      errors: allValidationErrors,
      summary: `Found ${
        allValidationErrors.length
      } inventory validation error(s) across ${
        new Set(allValidationErrors.map((e) => e.gdNo)).size
      } goods delivery(s).`,
    };
  }

  console.log("Bulk inventory validation passed for all selected GDs");
  return { isValid: true };
};

// Comprehensive bulk credit limit validation for all selected GDs
const validateBulkCreditLimits = async (goodsDeliveryData) => {
  console.log("Starting bulk credit limit validation for all selected GDs");

  const allCreditLimitErrors = [];

  for (const gdItem of goodsDeliveryData) {
    console.log(`Validating credit limits for GD: ${gdItem.delivery_no}`);

    // Skip if no accounting integration
    if (!gdItem.acc_integration_type || gdItem.acc_integration_type === null) {
      console.log(
        `Skipping credit limit check for GD ${gdItem.delivery_no} - no accounting integration`
      );
      continue;
    }

    try {
      // Get customer data
      const customerId = gdItem.customer_name?.id || gdItem.customer_name;
      if (!customerId) {
        console.warn(`No customer ID found for GD ${gdItem.delivery_no}`);
        continue;
      }

      const fetchCustomer = await db
        .collection("Customer")
        .where({ id: customerId, is_deleted: 0 })
        .get();

      const customerData = fetchCustomer.data?.[0];
      if (!customerData) {
        allCreditLimitErrors.push({
          gdNo: gdItem.delivery_no,
          customerName: gdItem.customer_name?.customer_com_name || customerId,
          error: `Customer not found`,
          type: "customer_not_found",
        });
        continue;
      }

      const controlTypes = customerData.control_type_list;
      const outstandingAmount =
        parseFloat(customerData.outstanding_balance || 0) || 0;
      const overdueAmount =
        parseFloat(customerData.overdue_inv_total_amount || 0) || 0;
      const overdueLimit = parseFloat(customerData.overdue_limit || 0) || 0;
      const creditLimit =
        parseFloat(customerData.customer_credit_limit || 0) || 0;
      const gdTotal = parseFloat(gdItem.gd_total || 0) || 0;
      const revisedOutstandingAmount = outstandingAmount + gdTotal;

      console.log(
        `Credit limit check for ${customerData.customer_com_name}: Outstanding=${outstandingAmount}, GD Total=${gdTotal}, Revised=${revisedOutstandingAmount}, Credit Limit=${creditLimit}, Overdue=${overdueAmount}, Overdue Limit=${overdueLimit}`
      );

      // Check if control types are defined
      if (
        !controlTypes ||
        !Array.isArray(controlTypes) ||
        controlTypes.length === 0
      ) {
        console.log(
          `No control types defined for customer ${customerData.customer_com_name}, allowing to proceed`
        );
        continue;
      }

      // Define control type behaviors
      const controlTypeChecks = {
        0: () => ({ result: true, priority: "unblock", status: "Passed" }),
        1: () => {
          if (overdueAmount > overdueLimit) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Overdue limit exceeded",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        2: () => {
          if (overdueAmount > overdueLimit) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Overdue limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        3: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Credit limit exceeded",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        4: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;
          if (creditExceeded && overdueExceeded) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Both credit and overdue limits exceeded",
            };
          } else if (creditExceeded) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Credit limit exceeded",
            };
          } else if (overdueExceeded) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Overdue limit exceeded",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        5: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;
          if (creditExceeded) {
            if (overdueExceeded) {
              return {
                result: false,
                priority: "block",
                status: "Blocked",
                reason: "Both credit and overdue limits exceeded",
              };
            } else {
              return {
                result: false,
                priority: "block",
                status: "Blocked",
                reason: "Credit limit exceeded",
              };
            }
          } else if (overdueExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Overdue limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        6: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Credit limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        7: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;
          if (overdueExceeded) {
            return {
              result: false,
              priority: "block",
              status: "Blocked",
              reason: "Overdue limit exceeded",
            };
          } else if (creditExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Credit limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        8: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;
          if (creditExceeded && overdueExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason:
                "Both credit and overdue limits exceeded (override required)",
            };
          } else if (creditExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Credit limit exceeded (override required)",
            };
          } else if (overdueExceeded) {
            return {
              result: false,
              priority: "override",
              status: "Override Required",
              reason: "Overdue limit exceeded (override required)",
            };
          }
          return { result: true, priority: "unblock", status: "Passed" };
        },
        9: () => {
          return {
            result: false,
            priority: "block",
            status: "Blocked",
            reason: "Customer account suspended",
          };
        },
      };

      // Process control types according to priority: unblock > block > override
      const results = [];
      for (const controlType of controlTypes) {
        const checkFunction = controlTypeChecks[controlType];
        if (checkFunction) {
          const result = checkFunction();
          results.push({ controlType, ...result });
        }
      }

      // Sort by priority: unblock first, then block, then override
      const priorityOrder = { unblock: 1, block: 2, override: 3 };
      results.sort(
        (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
      );

      // Use the highest priority result
      const finalResult = results[0];

      if (!finalResult.result) {
        // Credit limit check failed
        let errorMsg = `Customer "${customerData.customer_com_name}" failed credit limit validation: ${finalResult.reason}`;
        errorMsg += ` (Control Type: ${finalResult.controlType})`;

        // Add financial details
        if (finalResult.reason.includes("credit")) {
          errorMsg += `. Outstanding: ${outstandingAmount.toFixed(
            2
          )}, GD Total: ${gdTotal.toFixed(
            2
          )}, Total: ${revisedOutstandingAmount.toFixed(
            2
          )}, Credit Limit: ${creditLimit.toFixed(2)}`;
        }
        if (finalResult.reason.includes("overdue")) {
          errorMsg += `. Overdue Amount: ${overdueAmount.toFixed(
            2
          )}, Overdue Limit: ${overdueLimit.toFixed(2)}`;
        }

        allCreditLimitErrors.push({
          gdNo: gdItem.delivery_no,
          customerName: customerData.customer_com_name,
          error: errorMsg,
          type: finalResult.priority,
          status: finalResult.status,
          details: {
            controlType: finalResult.controlType,
            outstandingAmount,
            gdTotal,
            revisedOutstandingAmount,
            creditLimit,
            overdueAmount,
            overdueLimit,
            reason: finalResult.reason,
          },
        });
      } else {
        console.log(
          `Credit limit check passed for GD ${gdItem.delivery_no} - ${customerData.customer_com_name}`
        );
      }
    } catch (error) {
      console.error(
        `Error checking credit limits for GD ${gdItem.delivery_no}:`,
        error
      );
      allCreditLimitErrors.push({
        gdNo: gdItem.delivery_no,
        error: `Error checking credit limits: ${error.message}`,
        type: "system_error",
      });
    }
  }

  if (allCreditLimitErrors.length > 0) {
    console.log(
      "Bulk credit limit validation failed with errors:",
      allCreditLimitErrors
    );
    return {
      isValid: false,
      errors: allCreditLimitErrors,
      summary: `Found ${
        allCreditLimitErrors.length
      } credit limit validation error(s) across ${
        new Set(allCreditLimitErrors.map((e) => e.gdNo)).size
      } goods delivery(s).`,
    };
  }

  console.log("Bulk credit limit validation passed for all selected GDs");
  return { isValid: true };
};

// Check delivery quantities against SO limits with over-delivery tolerance
const checkBulkDeliveryQuantities = async (goodsDeliveryData) => {
  try {
    console.log("Checking delivery quantities with tolerance for bulk GDs...");

    const quantityIssues = [];

    for (const gdData of goodsDeliveryData) {
      const tableGD = gdData.table_gd || [];

      if (tableGD.length === 0) {
        continue;
      }

      console.log(
        `Checking delivery quantities for GD ${gdData.delivery_no}...`
      );

      // Get all unique SO line item IDs for batch fetching
      const soLineItemIds = tableGD
        .filter((item) => item.so_line_item_id && item.material_id)
        .map((item) => item.so_line_item_id);

      if (soLineItemIds.length === 0) {
        continue;
      }

      // Batch fetch SO line data
      const resSOLineData = await Promise.all(
        soLineItemIds.map(async (soLineItemId) => {
          try {
            const response = await db
              .collection("sales_order_axszx8cj_sub")
              .doc(soLineItemId)
              .get();
            return response.data ? response.data[0] : null;
          } catch (error) {
            console.warn(
              `Failed to fetch SO line item ${soLineItemId}:`,
              error
            );
            return null;
          }
        })
      );

      // Get all unique material IDs for batch fetching
      const materialIds = [
        ...new Set(
          tableGD
            .filter((item) => item.material_id)
            .map((item) => item.material_id)
        ),
      ];

      // Batch fetch item data
      const resItem = await Promise.all(
        materialIds.map(async (materialId) => {
          try {
            const response = await db
              .collection("Item")
              .where({ id: materialId })
              .get();
            return response.data && response.data.length > 0
              ? response.data[0]
              : null;
          } catch (error) {
            console.warn(`Failed to fetch item ${materialId}:`, error);
            return null;
          }
        })
      );

      // Create lookup maps for efficiency
      const soLineDataMap = new Map();
      resSOLineData.forEach((data, index) => {
        if (data) {
          soLineDataMap.set(soLineItemIds[index], data);
        }
      });

      const itemDataMap = new Map();
      resItem.forEach((data) => {
        if (data) {
          itemDataMap.set(data.id, data);
        }
      });

      // Check each GD line item
      for (const [index, item] of tableGD.entries()) {
        if (!item.material_id || item.material_id === "") {
          continue;
        }

        const soLine = soLineDataMap.get(item.so_line_item_id);
        const itemInfo = itemDataMap.get(item.material_id);

        if (!soLine) {
          console.warn(
            `SO line not found for item ${index + 1} in GD ${
              gdData.delivery_no
            }`
          );
          continue;
        }

        const tolerance = itemInfo ? itemInfo.over_delivery_tolerance || 0 : 0;
        const orderedQty = parseFloat(soLine.so_quantity || 0);
        const previouslyDeliveredQty = parseFloat(soLine.delivered_qty || 0);
        const currentDeliveryQty = parseFloat(item.gd_qty || 0);

        // Calculate maximum deliverable quantity considering tolerance
        const remainingQty = orderedQty - previouslyDeliveredQty;
        const maxDeliverableQty = remainingQty * ((100 + tolerance) / 100);

        console.log(
          `GD ${gdData.delivery_no}, Item ${index + 1}: ` +
            `Ordered: ${orderedQty}, Previously Delivered: ${previouslyDeliveredQty}, ` +
            `Current Delivery: ${currentDeliveryQty}, Max Allowed: ${maxDeliverableQty.toFixed(
              3
            )}, ` +
            `Tolerance: ${tolerance}%`
        );

        if (currentDeliveryQty > maxDeliverableQty) {
          quantityIssues.push({
            gdNo: gdData.delivery_no,
            lineNumber: index + 1,
            materialId: item.material_id,
            materialName:
              item.material_name || item.gd_material_desc || "Unknown Item",
            orderedQty: orderedQty,
            previouslyDeliveredQty: previouslyDeliveredQty,
            currentDeliveryQty: currentDeliveryQty,
            maxDeliverableQty: maxDeliverableQty,
            tolerance: tolerance,
            issue: `Delivery quantity ${currentDeliveryQty} exceeds maximum deliverable quantity ${maxDeliverableQty.toFixed(
              3
            )} (tolerance: ${tolerance}%)`,
          });

          console.log(
            `Quantity violation found in GD ${gdData.delivery_no}, line ${
              index + 1
            }: ` + `${currentDeliveryQty} > ${maxDeliverableQty.toFixed(3)}`
          );
        }
      }
    }

    if (quantityIssues.length > 0) {
      console.log(
        `Found ${quantityIssues.length} delivery quantity validation issues`
      );
      return {
        allPassed: false,
        failedGDs: quantityIssues,
        summary: `${quantityIssues.length} delivery line(s) exceed maximum deliverable quantities`,
      };
    }

    console.log(
      "Bulk delivery quantity validation passed for all selected GDs"
    );
    return {
      allPassed: true,
      failedGDs: [],
      summary: "All delivery quantities within tolerance",
    };
  } catch (error) {
    console.error("Error in bulk delivery quantity validation:", error);
    return {
      allPassed: false,
      failedGDs: [],
      summary: `Delivery quantity validation error: ${error.message}`,
    };
  }
};

// Check picking status requirements for bulk goods deliveries
const checkBulkPickingStatus = async (goodsDeliveryData) => {
  try {
    console.log("Checking picking status requirements for bulk GDs...");

    const pickingIssues = [];

    for (const gdData of goodsDeliveryData) {
      if (!gdData.plant_id.id) {
        pickingIssues.push({
          gdNo: gdData.delivery_no,
          issue: "Plant ID is required for picking setup validation",
        });
        continue;
      }

      // Check if plant has picking setup for Good Delivery
      const pickingSetupData = await db
        .collection("picking_setup")
        .where({
          plant_id: gdData.plant_id.id,
          movement_type: "Good Delivery",
          picking_required: 1,
        })
        .get();

      // If no picking setup found, allow normal processing
      if (!pickingSetupData.data || pickingSetupData.data.length === 0) {
        console.log(
          `No picking setup found for plant ${gdData.plant_id.id} in GD ${gdData.delivery_no}, proceeding normally`
        );
        continue;
      }

      console.log(
        `Picking setup found for plant ${gdData.plant_id.id} in GD ${gdData.delivery_no}. Checking requirements...`
      );

      // For bulk action (Edit mode with Created status), check if picking is completed
      if (gdData.gd_status === "Created") {
        if (gdData.picking_status !== "Completed") {
          pickingIssues.push({
            gdNo: gdData.delivery_no,
            plantId: gdData.plant_id.id,
            currentStatus: gdData.picking_status || "Not Started",
            issue:
              "Picking process must be completed before goods delivery completion",
          });
        } else {
          console.log(
            `Picking completed for GD ${gdData.delivery_no}, allowing completion`
          );
        }
      }
    }

    if (pickingIssues.length > 0) {
      console.log(`Found ${pickingIssues.length} picking validation issues`);
      return {
        allPassed: false,
        failedGDs: pickingIssues,
        summary: `${pickingIssues.length} goods delivery(s) require completed picking process`,
      };
    }

    console.log("Bulk picking validation passed for all selected GDs");
    return {
      allPassed: true,
      failedGDs: [],
      summary: "All picking requirements met",
    };
  } catch (error) {
    console.error("Error in bulk picking validation:", error);
    return {
      allPassed: false,
      failedGDs: [],
      summary: `Picking validation error: ${error.message}`,
    };
  }
};

// Check for existing reserved goods conflicts for bulk goods deliveries
const checkBulkExistingReservedGoods = async (
  goodsDeliveryData,
  organizationId
) => {
  try {
    console.log("Checking existing reserved goods conflicts for bulk GDs...");

    const conflictIssues = [];

    for (const gdData of goodsDeliveryData) {
      // Collect all SO numbers from this GD
      const soNumbers = [];

      // From header
      if (gdData.so_no) {
        if (typeof gdData.so_no === "string") {
          gdData.so_no.split(",").forEach((so) => soNumbers.push(so.trim()));
        } else {
          soNumbers.push(gdData.so_no.toString());
        }
      }

      // From line items
      if (Array.isArray(gdData.table_gd)) {
        gdData.table_gd.forEach((item) => {
          if (item.line_so_no) {
            soNumbers.push(item.line_so_no.toString().trim());
          }
        });
      }

      // Remove duplicates and empty values
      const uniqueSONumbers = [...new Set(soNumbers)].filter(
        (so) => so.length > 0
      );

      if (uniqueSONumbers.length === 0) {
        console.log(
          `No SO numbers found for GD ${gdData.delivery_no}, skipping conflict check`
        );
        continue;
      }

      console.log(
        `Checking reserved goods conflicts for GD ${
          gdData.delivery_no
        } with SOs: ${uniqueSONumbers.join(", ")}`
      );

      // Check each SO number for conflicts
      for (const soNo of uniqueSONumbers) {
        const query = {
          parent_no: soNo,
          organization_id: organizationId,
          doc_type: "Good Delivery",
          is_deleted: 0,
        };

        // Get current GD's delivery_no to exclude it
        const currentGdNo = gdData.delivery_no;
        console.log(
          `Excluding current GD ${currentGdNo} from validation check for SO ${soNo}`
        );

        // Get all reserved goods for this specific SO
        const allReservedResponse = await db
          .collection("on_reserved_gd")
          .where(query)
          .get();

        if (allReservedResponse.data && allReservedResponse.data.length > 0) {
          // Filter out records belonging to the current GD
          const otherReservedRecords = allReservedResponse.data.filter(
            (record) => record.doc_no !== currentGdNo
          );

          // Check if any other GD has open quantities for this SO
          const hasOpenQty = otherReservedRecords.some(
            (record) => parseFloat(record.open_qty || 0) > 0
          );

          if (hasOpenQty) {
            // Get the GD number that has open quantities
            const conflictingRecord = otherReservedRecords.find(
              (record) => parseFloat(record.open_qty || 0) > 0
            );

            conflictIssues.push({
              gdNo: gdData.delivery_no,
              conflictingSoNo: soNo,
              conflictingGdNo: conflictingRecord.doc_no,
              openQty: conflictingRecord.open_qty,
              issue: `SO ${soNo} has open quantities reserved by another GD (${conflictingRecord.doc_no})`,
            });

            console.log(
              `Conflict found: GD ${gdData.delivery_no} conflicts with ${conflictingRecord.doc_no} for SO ${soNo}`
            );
            break; // Found conflict for this GD, no need to check other SOs
          }
        }
      }
    }

    if (conflictIssues.length > 0) {
      console.log(
        `Found ${conflictIssues.length} reserved goods conflict issues`
      );
      return {
        allPassed: false,
        failedGDs: conflictIssues,
        summary: `${conflictIssues.length} goods delivery(s) have reserved goods conflicts`,
      };
    }

    console.log(
      "Bulk reserved goods conflict check passed for all selected GDs"
    );
    return {
      allPassed: true,
      failedGDs: [],
      summary: "No reserved goods conflicts found",
    };
  } catch (error) {
    console.error("Error in bulk reserved goods conflict check:", error);
    return {
      allPassed: false,
      failedGDs: [],
      summary: `Reserved goods conflict check error: ${error.message}`,
    };
  }
};

// Update FIFO inventory
const updateFIFOInventory = (materialId, deliveryQty, batchId, plantId) => {
  return new Promise((resolve, reject) => {
    const query = batchId
      ? db.collection("fifo_costing_history").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db
          .collection("fifo_costing_history")
          .where({ material_id: materialId, plant_id: plantId });

    query
      .get()
      .then((response) => {
        const result = response.data;

        if (result && Array.isArray(result) && result.length > 0) {
          // Sort by FIFO sequence (lowest/oldest first)
          const sortedRecords = result.sort(
            (a, b) => a.fifo_sequence - b.fifo_sequence
          );

          let remainingQtyToDeduct = parseFloat(deliveryQty);
          console.log(
            `Need to deduct ${remainingQtyToDeduct} units from FIFO inventory`
          );

          // Process each FIFO record in sequence until we've accounted for all delivery quantity
          for (const record of sortedRecords) {
            if (remainingQtyToDeduct <= 0) {
              break;
            }

            const availableQty = roundQty(record.fifo_available_quantity || 0);
            console.log(
              `FIFO record ${record.fifo_sequence} has ${availableQty} available`
            );

            // Calculate how much to take from this record
            const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);
            const newAvailableQty = roundQty(availableQty - qtyToDeduct);

            console.log(
              `Deducting ${qtyToDeduct} from FIFO record ${record.fifo_sequence}, new available: ${newAvailableQty}`
            );

            // Update this FIFO record
            db.collection("fifo_costing_history")
              .doc(record.id)
              .update({
                fifo_available_quantity: newAvailableQty,
              })
              .catch((error) =>
                console.error(
                  `Error updating FIFO record ${record.fifo_sequence}:`,
                  error
                )
              );

            // Reduce the remaining quantity to deduct
            remainingQtyToDeduct -= qtyToDeduct;
          }

          if (remainingQtyToDeduct > 0) {
            console.warn(
              `Warning: Couldn't fully satisfy FIFO deduction. Remaining qty: ${remainingQtyToDeduct}`
            );
          }
        } else {
          console.warn(`No FIFO records found for material ${materialId}`);
        }
      })
      .catch((error) =>
        console.error(
          `Error retrieving FIFO history for material ${materialId}:`,
          error
        )
      )
      .then(() => {
        resolve();
      })
      .catch((error) => {
        console.error(`Error in FIFO update:`, error);
        reject(error);
      });
  });
};

const updateWeightedAverage = (item, batchId, baseWAQty, plantId) => {
  // Input validation
  if (
    !item ||
    !item.material_id ||
    isNaN(parseFloat(baseWAQty)) ||
    parseFloat(baseWAQty) <= 0
  ) {
    console.error("Invalid item data for weighted average update:", item);
    return Promise.resolve();
  }

  const deliveredQty = parseFloat(baseWAQty);
  const query = batchId
    ? db.collection("wa_costing_method").where({
        material_id: item.material_id,
        batch_id: batchId,
        plant_id: plantId,
      })
    : db
        .collection("wa_costing_method")
        .where({ material_id: item.material_id, plant_id: plantId });

  return query
    .get()
    .then((waResponse) => {
      const waData = waResponse.data;
      if (!waData || !Array.isArray(waData) || waData.length === 0) {
        console.warn(
          `No weighted average records found for material ${item.material_id}`
        );
        return Promise.resolve();
      }

      // Sort by date (newest first) to get the latest record
      waData.sort((a, b) => {
        if (a.created_at && b.created_at) {
          return new Date(b.created_at) - new Date(a.created_at);
        }
        return 0;
      });

      const waDoc = waData[0];
      const waCostPrice = roundPrice(waDoc.wa_cost_price || 0);
      const waQuantity = roundQty(waDoc.wa_quantity || 0);

      if (waQuantity <= deliveredQty) {
        console.warn(
          `Warning: Cannot fully update weighted average for ${item.material_id} - ` +
            `Available: ${waQuantity}, Requested: ${deliveredQty}`
        );

        if (waQuantity <= 0) {
          return Promise.resolve();
        }
      }

      const newWaQuantity = Math.max(0, roundQty(waQuantity - deliveredQty));

      // If new quantity would be zero, handle specially
      if (newWaQuantity === 0) {
        return db
          .collection("wa_costing_method")
          .doc(waDoc.id)
          .update({
            wa_quantity: 0,
            updated_at: new Date(),
          })
          .then(() => {
            console.log(
              `Updated Weighted Average for item ${item.material_id} to zero quantity`
            );
            return Promise.resolve();
          });
      }

      // const calculatedWaCostPrice = roundPrice(
      //   (waCostPrice * waQuantity - waCostPrice * deliveredQty) / newWaQuantity
      // );
      // const newWaCostPrice = Math.round(calculatedWaCostPrice * 10000) / 10000;

      return db
        .collection("wa_costing_method")
        .doc(waDoc.id)
        .update({
          wa_quantity: newWaQuantity,
          wa_cost_price: waCostPrice,
          updated_at: new Date(),
        })
        .then(() => {
          console.log(
            `Successfully processed Weighted Average for item ${item.material_id}, ` +
              `new quantity: ${newWaQuantity}, new cost price: ${waCostPrice}`
          );
          return Promise.resolve();
        });
    })
    .catch((error) => {
      console.error(
        `Error processing Weighted Average for item ${
          item?.material_id || "unknown"
        }:`,
        error
      );
      return Promise.reject(error);
    });
};

// Function to get latest FIFO cost price with available quantity check
const getLatestFIFOCostPrice = async (
  materialId,
  batchId,
  deductionQty = null,
  previouslyConsumedQty = 0,
  plantId
) => {
  try {
    const query = batchId
      ? db.collection("fifo_costing_history").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db
          .collection("fifo_costing_history")
          .where({ material_id: materialId, plant_id: plantId });

    const response = await query.get();
    const result = response.data;

    if (result && Array.isArray(result) && result.length > 0) {
      // Sort by FIFO sequence (lowest/oldest first, as per FIFO principle)
      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      // Process previously consumed quantities to simulate their effect on available quantities
      if (previouslyConsumedQty > 0) {
        let qtyToSkip = previouslyConsumedQty;

        console.log(
          `Adjusting for ${previouslyConsumedQty} units already consumed in this transaction`
        );

        // Simulate the effect of previous consumption on available quantities
        for (let i = 0; i < sortedRecords.length && qtyToSkip > 0; i++) {
          const record = sortedRecords[i];
          const availableQty = roundQty(record.fifo_available_quantity || 0);

          if (availableQty <= 0) continue;

          // If this record has enough quantity, just reduce it
          if (availableQty >= qtyToSkip) {
            record._adjustedAvailableQty = roundQty(availableQty - qtyToSkip);
            console.log(
              `FIFO record ${record.fifo_sequence}: Adjusted available from ${availableQty} to ${record._adjustedAvailableQty} (consumed ${qtyToSkip})`
            );
            qtyToSkip = 0;
          } else {
            // Otherwise, consume all of this record and continue to next
            record._adjustedAvailableQty = 0;
            console.log(
              `FIFO record ${record.fifo_sequence}: Fully consumed ${availableQty} units, no remainder`
            );
            qtyToSkip = roundQty(qtyToSkip - availableQty);
          }
        }

        if (qtyToSkip > 0) {
          console.warn(
            `Warning: Could not account for all previously consumed quantity. Remaining: ${qtyToSkip}`
          );
        }
      }

      // If no deduction quantity is provided, just return the cost price of the first record with available quantity
      if (!deductionQty) {
        // First look for records with available quantity
        for (const record of sortedRecords) {
          // Use adjusted quantity if available, otherwise use original
          const availableQty = roundQty(
            record._adjustedAvailableQty !== undefined
              ? record._adjustedAvailableQty
              : record.fifo_available_quantity || 0
          );

          if (availableQty > 0) {
            console.log(
              `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
            );
            return roundPrice(record.fifo_cost_price || 0);
          }
        }

        // If no records with available quantity, use the most recent record
        console.warn(
          `No FIFO records with available quantity found for ${materialId}, using most recent cost price`
        );
        return roundPrice(
          sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
        );
      }

      // If deduction quantity is provided, calculate weighted average cost price across multiple FIFO records
      let remainingQtyToDeduct = roundQty(deductionQty);
      let totalCost = 0;
      let totalDeductedQty = 0;

      // Log the calculation process
      console.log(
        `Calculating weighted average FIFO cost for ${materialId}, deduction quantity: ${remainingQtyToDeduct}`
      );

      // Process each FIFO record in sequence until we've accounted for all deduction quantity
      for (const record of sortedRecords) {
        if (remainingQtyToDeduct <= 0) {
          break;
        }

        // Use adjusted quantity if available, otherwise use original
        const availableQty = roundQty(
          record._adjustedAvailableQty !== undefined
            ? record._adjustedAvailableQty
            : record.fifo_available_quantity || 0
        );

        if (availableQty <= 0) {
          continue; // Skip records with no available quantity
        }

        const costPrice = roundPrice(record.fifo_cost_price || 0);
        const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);

        const costContribution = roundPrice(qtyToDeduct * costPrice);
        totalCost = roundPrice(totalCost + costContribution);
        totalDeductedQty = roundQty(totalDeductedQty + qtyToDeduct);

        console.log(
          `FIFO record ${record.fifo_sequence}: Deducting ${qtyToDeduct} units at ${costPrice} per unit = ${costContribution}`
        );

        remainingQtyToDeduct = roundQty(remainingQtyToDeduct - qtyToDeduct);
      }

      // If we couldn't satisfy the full deduction from available records, issue a warning
      if (remainingQtyToDeduct > 0) {
        console.warn(
          `Warning: Not enough FIFO quantity available. Remaining to deduct: ${remainingQtyToDeduct}`
        );

        // For the remaining quantity, use the last record's cost price
        if (sortedRecords.length > 0) {
          const lastRecord = sortedRecords[sortedRecords.length - 1];
          const lastCostPrice = roundPrice(lastRecord.fifo_cost_price || 0);

          console.log(
            `Using last FIFO record's cost price (${lastCostPrice}) for remaining ${remainingQtyToDeduct} units`
          );

          const additionalCost = roundPrice(
            remainingQtyToDeduct * lastCostPrice
          );
          totalCost = roundPrice(totalCost + additionalCost);
          totalDeductedQty = roundQty(totalDeductedQty + remainingQtyToDeduct);
        }
      }

      // Calculate the weighted average cost price
      if (totalDeductedQty > 0) {
        const weightedAvgCost = roundPrice(totalCost / totalDeductedQty);
        console.log(
          `Weighted Average FIFO Cost: ${totalCost} / ${totalDeductedQty} = ${weightedAvgCost}`
        );
        return weightedAvgCost;
      }

      // Fallback to first record with cost if no quantity could be deducted
      return roundPrice(sortedRecords[0].fifo_cost_price || 0);
    }

    console.warn(`No FIFO records found for material ${materialId}`);
    return 0;
  } catch (error) {
    console.error(`Error retrieving FIFO cost price for ${materialId}:`, error);
    return 0;
  }
};

// Function to get Weighted Average cost price
const getWeightedAverageCostPrice = async (materialId, batchId, plantId) => {
  try {
    const query = batchId
      ? db.collection("wa_costing_method").where({
          material_id: materialId,
          batch_id: batchId,
          plant_id: plantId,
        })
      : db
          .collection("wa_costing_method")
          .where({ material_id: materialId, plant_id: plantId });

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

      return roundPrice(waData[0].wa_cost_price || 0);
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
  try {
    const query = db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;

    if (result && result.length > 0) {
      return roundPrice(parseFloat(result[0].purchase_unit_price || 0));
    }

    return 0;
  } catch (error) {
    console.error(
      `Error retrieving fixed cost price for ${materialId}:`,
      error
    );
    return 0;
  }
};

const updateEntryWithValidation = async (
  organizationId,
  gd,
  gdStatus,
  goodsDeliveryId
) => {
  try {
    await fillbackHeaderFields(gd);

    await processBalanceTable(
      gd,
      true,
      gd.plant_id.id,
      organizationId,
      gdStatus
    );

    console.log("table_gd", gd.table_gd);

    await db.collection("goods_delivery").doc(goodsDeliveryId).update({
      gd_status: "Completed",
      table_gd: gd.table_gd,
    });

    const { so_data_array } = await updateSalesOrderStatus(
      gd.so_id.length > 0 ? gd.so_id.map((item) => item.id) : [],
      gd.table_gd
    );

    await this.runWorkflow(
      "1918140858502557698",
      { delivery_no: gd.delivery_no, so_data: so_data_array },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        alert();
        console.error("失败结果：", err);
        closeDialog();
      }
    );

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    // Handle inventory validation gracefully
    if (
      error.message &&
      error.message.includes("Inventory validation failed")
    ) {
      console.log(
        "Inventory validation failed - user notified via alert dialog"
      );
      return;
    }

    this.$message.error(error);
    throw error;
  }
};

const processBalanceTable = async (
  data,
  isUpdate,
  plantId,
  organizationId,
  gdStatus
) => {
  console.log(
    "Processing balance table with grouped movements (including serialized items)"
  );
  const items = data.table_gd;

  // Store previous temporary quantities
  items.forEach((item) => {
    item.prev_temp_qty_data = item.temp_qty_data;
  });

  if (!Array.isArray(items) || items.length === 0) {
    console.log("No items to process");
    return Promise.resolve();
  }

  // Create a map to track consumed FIFO quantities during this transaction
  const consumedFIFOQty = new Map();

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    const updatedDocs = [];
    const createdDocs = [];

    try {
      console.log(`Processing item ${itemIndex + 1}/${items.length}`);

      // Input validation
      if (!item.material_id || !item.temp_qty_data) {
        console.error(`Invalid item data for index ${itemIndex}:`, item);
        continue;
      }

      // First check if this item should be processed based on stock_control
      const itemRes = await db
        .collection("Item")
        .where({ id: item.material_id })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.material_id}`);
        return;
      }

      const itemData = itemRes.data[0];
      if (itemData.stock_control === 0) {
        console.log(
          `Skipping inventory update for item ${item.material_id} (stock_control=0)`
        );
        return;
      }

      // Check if item is serialized
      const isSerializedItem = itemData.serial_number_management === 1;
      const isBatchManagedItem = itemData.item_batch_management === 1;

      console.log(
        `Item ${item.material_id}: Serialized=${isSerializedItem}, Batch=${isBatchManagedItem}`
      );

      const temporaryData = parseJsonSafely(item.temp_qty_data);
      const prevTempData = isUpdate
        ? parseJsonSafely(item.prev_temp_qty_data)
        : null;

      if (
        temporaryData.length > 0 &&
        (!isUpdate || (prevTempData && prevTempData.length > 0))
      ) {
        // GROUP temp_qty_data by location + batch combination for movement consolidation
        const groupedTempData = new Map();

        for (const temp of temporaryData) {
          // Create grouping key based on location and batch (if applicable)
          let groupKey;
          if (isBatchManagedItem && temp.batch_id) {
            groupKey = `${temp.location_id}|${temp.batch_id}`;
          } else {
            groupKey = temp.location_id;
          }

          if (!groupedTempData.has(groupKey)) {
            groupedTempData.set(groupKey, {
              location_id: temp.location_id,
              batch_id: temp.batch_id,
              items: [],
              totalQty: 0,
            });
          }

          const group = groupedTempData.get(groupKey);
          group.items.push(temp);
          group.totalQty += parseFloat(temp.gd_quantity || 0);
        }

        console.log(
          `Grouped ${temporaryData.length} items into ${groupedTempData.size} movement groups`
        );

        // Process each group to create consolidated movements
        for (const [groupKey, group] of groupedTempData) {
          console.log(
            `Processing group: ${groupKey} with ${group.items.length} items, total qty: ${group.totalQty}`
          );

          // UOM Conversion for the group
          let altQty = roundQty(group.totalQty);
          let baseQty = altQty;
          let altUOM = item.gd_order_uom_id;
          let baseUOM = itemData.based_uom;
          let altWAQty = roundQty(item.gd_qty);
          let baseWAQty = altWAQty;
          let uomConversion = null;

          if (
            Array.isArray(itemData.table_uom_conversion) &&
            itemData.table_uom_conversion.length > 0
          ) {
            console.log(`Checking UOM conversions for item ${item.item_id}`);

            uomConversion = itemData.table_uom_conversion.find(
              (conv) => conv.alt_uom_id === altUOM
            );

            if (uomConversion) {
              console.log(
                `Found UOM conversion: 1 ${uomConversion.alt_uom_id} = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
              );

              baseQty = roundQty(altQty * uomConversion.base_qty);
              baseWAQty = roundQty(altWAQty * uomConversion.base_qty);

              console.log(
                `Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`
              );
            } else {
              console.log(`No conversion found for UOM ${altUOM}, using as-is`);
            }
          } else {
            console.log(
              `No UOM conversion table for item ${item.item_id}, using received quantity as-is`
            );
          }

          // Calculate previous quantities for this specific GD group
          let prevBaseQty = 0;
          if (isUpdate && prevTempData) {
            // Find matching previous group quantities
            for (const prevTemp of prevTempData) {
              let prevGroupKey;
              if (isBatchManagedItem && prevTemp.batch_id) {
                prevGroupKey = `${prevTemp.location_id}|${prevTemp.batch_id}`;
              } else {
                prevGroupKey = prevTemp.location_id;
              }

              if (prevGroupKey === groupKey) {
                let prevAltQty = roundQty(prevTemp.gd_quantity);
                let currentPrevBaseQty = prevAltQty;

                if (uomConversion) {
                  currentPrevBaseQty = roundQty(
                    prevAltQty * uomConversion.base_qty
                  );
                }
                prevBaseQty += currentPrevBaseQty;
              }
            }
            console.log(
              `Previous quantity for this GD group ${groupKey}: ${prevBaseQty}`
            );
          }

          const costingMethod = itemData.material_costing_method;

          let unitPrice = roundPrice(item.unit_price);
          let totalPrice = roundPrice(unitPrice * altQty);

          if (costingMethod === "First In First Out") {
            // Define a key for tracking consumed FIFO quantities
            const materialBatchKey = group.batch_id
              ? `${item.material_id}-${group.batch_id}`
              : item.material_id;

            // Get previously consumed quantity (default to 0 if none)
            const previouslyConsumedQty =
              consumedFIFOQty.get(materialBatchKey) || 0;

            // Get unit price from latest FIFO sequence with awareness of consumed quantities
            const fifoCostPrice = await getLatestFIFOCostPrice(
              item.material_id,
              group.batch_id,
              baseQty,
              previouslyConsumedQty,
              plantId
            );

            // Update the consumed quantity for this material/batch
            consumedFIFOQty.set(
              materialBatchKey,
              previouslyConsumedQty + baseQty
            );

            unitPrice = roundPrice(fifoCostPrice);
            totalPrice = roundPrice(fifoCostPrice * baseQty);
          } else if (costingMethod === "Weighted Average") {
            // Get unit price from WA cost price
            const waCostPrice = await getWeightedAverageCostPrice(
              item.material_id,
              group.batch_id,
              plantId
            );
            unitPrice = roundPrice(waCostPrice);
            totalPrice = roundPrice(waCostPrice * baseQty);
          } else if (costingMethod === "Fixed Cost") {
            // Get unit price from Fixed Cost
            const fixedCostPrice = await getFixedCostPrice(item.material_id);
            unitPrice = roundPrice(fixedCostPrice);
            totalPrice = roundPrice(fixedCostPrice * baseQty);
          } else {
            return Promise.resolve();
          }

          // Get current balance to determine smart movement logic
          let itemBalanceParams = {
            material_id: item.material_id,
            plant_id: plantId,
            organization_id: organizationId,
          };

          let balanceCollection;
          let hasExistingBalance = false;
          let existingDoc = null;

          if (isSerializedItem) {
            // For serialized items, we'll process balance updates individually
            // but create consolidated movements
            console.log(
              `Processing serialized item group with ${group.items.length} serials`
            );
          } else {
            // For non-serialized items, use location-based balance
            itemBalanceParams.location_id = group.location_id;

            if (group.batch_id) {
              itemBalanceParams.batch_id = group.batch_id;
              balanceCollection = "item_batch_balance";
            } else {
              balanceCollection = "item_balance";
            }

            const balanceQuery = await db
              .collection(balanceCollection)
              .where(itemBalanceParams)
              .get();

            hasExistingBalance =
              balanceQuery.data &&
              Array.isArray(balanceQuery.data) &&
              balanceQuery.data.length > 0;
            existingDoc = hasExistingBalance ? balanceQuery.data[0] : null;
          }

          // Create base inventory movement data (CONSOLIDATED)
          const baseInventoryMovement = {
            transaction_type: "GDL",
            trx_no: data.delivery_no,
            parent_trx_no: item.line_so_no,
            unit_price: unitPrice,
            total_price: totalPrice,
            quantity: altQty, // CONSOLIDATED quantity
            item_id: item.material_id,
            uom_id: altUOM,
            base_qty: baseQty, // CONSOLIDATED base quantity
            base_uom_id: baseUOM,
            bin_location_id: group.location_id,
            batch_number_id: group.batch_id || null,
            costing_method_id: item.item_costing_method,
            plant_id: plantId,
            organization_id: organizationId,
            is_deleted: 0,
          };

          let totalGroupUnrestricted = 0;
          let totalGroupReserved = 0;
          let serialBalances = [];

          // Handle balance logic for serialized vs non-serialized items
          if (isSerializedItem) {
            // For serialized items, we need to calculate group totals instead of using first serial's balance
            console.log(
              `Processing serialized item group with ${group.items.length} serials individually for balance calculations`
            );

            for (const temp of group.items) {
              if (temp.serial_number) {
                const serialBalanceParams = {
                  material_id: item.material_id,
                  serial_number: temp.serial_number,
                  plant_id: plantId,
                  organization_id: organizationId,
                  location_id: temp.location_id,
                };

                if (isBatchManagedItem && temp.batch_id) {
                  serialBalanceParams.batch_id = temp.batch_id;
                }

                try {
                  const serialBalanceQuery = await db
                    .collection("item_serial_balance")
                    .where(serialBalanceParams)
                    .get();

                  if (
                    serialBalanceQuery.data &&
                    serialBalanceQuery.data.length > 0
                  ) {
                    const balance = serialBalanceQuery.data[0];
                    const unrestrictedQty = roundQty(
                      parseFloat(balance.unrestricted_qty || 0)
                    );
                    const reservedQty = roundQty(
                      parseFloat(balance.reserved_qty || 0)
                    );

                    totalGroupUnrestricted += unrestrictedQty;
                    totalGroupReserved += reservedQty;

                    serialBalances.push({
                      serial: temp.serial_number,
                      balance: balance,
                      unrestricted: unrestrictedQty,
                      reserved: reservedQty,
                      individualQty: roundQty(temp.gd_quantity),
                      individualBaseQty: uomConversion
                        ? roundQty(temp.gd_quantity * uomConversion.base_qty)
                        : roundQty(temp.gd_quantity),
                    });

                    console.log(
                      `Serial ${temp.serial_number}: Unrestricted=${unrestrictedQty}, Reserved=${reservedQty}`
                    );
                  } else {
                    console.warn(
                      `No balance found for serial: ${temp.serial_number}`
                    );
                  }
                } catch (balanceError) {
                  console.error(
                    `Error fetching balance for serial ${temp.serial_number}:`,
                    balanceError
                  );
                  throw balanceError;
                }
              }
            }

            console.log(
              `Group ${groupKey} totals: Unrestricted=${totalGroupUnrestricted}, Reserved=${totalGroupReserved}, Required=${baseQty}`
            );

            // Use group totals for movement logic decisions instead of single serial balance
            hasExistingBalance = serialBalances.length > 0;
            existingDoc = hasExistingBalance
              ? {
                  unrestricted_qty: totalGroupUnrestricted,
                  reserved_qty: totalGroupReserved,
                  id: "group_total", // Dummy ID for group processing
                }
              : null;
          } else {
            // Keep your existing non-serialized logic unchanged
            itemBalanceParams.location_id = group.location_id;

            if (group.batch_id) {
              itemBalanceParams.batch_id = group.batch_id;
              balanceCollection = "item_batch_balance";
            } else {
              balanceCollection = "item_balance";
            }

            const balanceQuery = await db
              .collection(balanceCollection)
              .where(itemBalanceParams)
              .get();

            hasExistingBalance =
              balanceQuery.data &&
              Array.isArray(balanceQuery.data) &&
              balanceQuery.data.length > 0;
            existingDoc = hasExistingBalance ? balanceQuery.data[0] : null;
          }

          if (existingDoc && existingDoc.id) {
            // Get current balance quantities (from representative document)
            let currentUnrestrictedQty = roundQty(
              parseFloat(existingDoc.unrestricted_qty || 0)
            );
            let currentReservedQty = roundQty(
              parseFloat(existingDoc.reserved_qty || 0)
            );
            let currentBalanceQty = isSerializedItem
              ? roundQty(currentUnrestrictedQty + currentReservedQty)
              : roundQty(parseFloat(existingDoc.balance_quantity || 0));

            console.log(
              `Current inventory for group ${groupKey}${
                isSerializedItem
                  ? ` (Reference Serial: ${group.items[0].serial_number})`
                  : ""
              }:`
            );
            console.log(`  Unrestricted: ${currentUnrestrictedQty}`);
            console.log(`  Reserved: ${currentReservedQty}`);
            console.log(`  Total Balance: ${currentBalanceQty}`);

            // Smart movement logic based on status and available quantities
            if (gdStatus === "Created") {
              // For Created status, we need to move OUT from Reserved
              console.log(
                `Processing Created status - moving ${baseQty} OUT from Reserved for group ${groupKey}`
              );

              // For edit mode, we can only use the reserved quantity that this GD previously created
              let availableReservedForThisGD = currentReservedQty;
              if (isUpdate && prevBaseQty > 0) {
                // In edit mode, we can only take up to what this GD previously reserved
                availableReservedForThisGD = Math.min(
                  currentReservedQty,
                  prevBaseQty
                );
                console.log(
                  `This GD previously reserved for group ${groupKey}: ${prevBaseQty}`
                );
                console.log(
                  `Available reserved for this GD: ${availableReservedForThisGD}`
                );
              }

              if (availableReservedForThisGD >= baseQty) {
                // Sufficient reserved quantity from this GD - create single OUT movement from Reserved
                console.log(
                  `Sufficient reserved quantity for this GD (${availableReservedForThisGD}) for ${baseQty}`
                );

                const inventoryMovementData = {
                  ...baseInventoryMovement,
                  movement: "OUT",
                  inventory_category: "Reserved",
                };

                await db
                  .collection("inventory_movement")
                  .add(inventoryMovementData);

                // Wait and fetch the created movement ID
                await new Promise((resolve) => setTimeout(resolve, 100));

                const movementQuery = await db
                  .collection("inventory_movement")
                  .where({
                    transaction_type: "GDL",
                    trx_no: data.delivery_no,
                    parent_trx_no: item.line_so_no,
                    movement: "OUT",
                    inventory_category: "Reserved",
                    item_id: item.material_id,
                    bin_location_id: group.location_id,
                    base_qty: baseQty,
                    plant_id: plantId,
                    organization_id: organizationId,
                  })
                  .get();

                if (movementQuery.data && movementQuery.data.length > 0) {
                  const movementId = movementQuery.data.sort(
                    (a, b) => new Date(b.create_time) - new Date(a.create_time)
                  )[0].id;

                  createdDocs.push({
                    collection: "inventory_movement",
                    docId: movementId,
                    groupKey: groupKey,
                  });

                  console.log(
                    `Created consolidated OUT movement from Reserved for group ${groupKey}: ${baseQty}, ID: ${movementId}`
                  );
                }
              } else {
                // Insufficient reserved quantity for this GD - split between Reserved and Unrestricted
                const reservedQtyToMove = availableReservedForThisGD;
                const unrestrictedQtyToMove = roundQty(
                  baseQty - reservedQtyToMove
                );

                console.log(
                  `Insufficient reserved quantity for this GD. Splitting group ${groupKey}:`
                );
                console.log(
                  `  OUT ${reservedQtyToMove} from Reserved (from this GD's allocation)`
                );
                console.log(
                  `  OUT ${unrestrictedQtyToMove} from Unrestricted (additional quantity)`
                );

                if (reservedQtyToMove > 0) {
                  // Create movement for Reserved portion
                  const reservedAltQty = roundQty(
                    (reservedQtyToMove / baseQty) * altQty
                  );
                  const reservedTotalPrice = roundPrice(
                    unitPrice * reservedAltQty
                  );

                  const reservedMovementData = {
                    ...baseInventoryMovement,
                    movement: "OUT",
                    inventory_category: "Reserved",
                    quantity: reservedAltQty,
                    total_price: reservedTotalPrice,
                    base_qty: reservedQtyToMove,
                  };

                  await db
                    .collection("inventory_movement")
                    .add(reservedMovementData);

                  // Wait and fetch the reserved movement ID
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const reservedMovementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: data.delivery_no,
                      parent_trx_no: item.line_so_no,
                      movement: "OUT",
                      inventory_category: "Reserved",
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      base_qty: reservedQtyToMove,
                      plant_id: plantId,
                      organization_id: organizationId,
                    })
                    .get();

                  if (
                    reservedMovementQuery.data &&
                    reservedMovementQuery.data.length > 0
                  ) {
                    const reservedMovementId = reservedMovementQuery.data.sort(
                      (a, b) =>
                        new Date(b.create_time) - new Date(a.create_time)
                    )[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: reservedMovementId,
                      groupKey: groupKey,
                    });

                    console.log(
                      `Created consolidated OUT movement from Reserved for group ${groupKey}: ${reservedQtyToMove}, ID: ${reservedMovementId}`
                    );
                  }
                }

                if (unrestrictedQtyToMove > 0) {
                  // Create movement for Unrestricted portion
                  const unrestrictedAltQty = roundQty(
                    (unrestrictedQtyToMove / baseQty) * altQty
                  );
                  const unrestrictedTotalPrice = roundPrice(
                    unitPrice * unrestrictedAltQty
                  );

                  const unrestrictedMovementData = {
                    ...baseInventoryMovement,
                    movement: "OUT",
                    inventory_category: "Unrestricted",
                    quantity: unrestrictedAltQty,
                    total_price: unrestrictedTotalPrice,
                    base_qty: unrestrictedQtyToMove,
                  };

                  await db
                    .collection("inventory_movement")
                    .add(unrestrictedMovementData);

                  // Wait and fetch the unrestricted movement ID
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const unrestrictedMovementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: data.delivery_no,
                      parent_trx_no: item.line_so_no,
                      movement: "OUT",
                      inventory_category: "Unrestricted",
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      base_qty: unrestrictedQtyToMove,
                      plant_id: plantId,
                      organization_id: organizationId,
                    })
                    .get();

                  if (
                    unrestrictedMovementQuery.data &&
                    unrestrictedMovementQuery.data.length > 0
                  ) {
                    const unrestrictedMovementId =
                      unrestrictedMovementQuery.data.sort(
                        (a, b) =>
                          new Date(b.create_time) - new Date(a.create_time)
                      )[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: unrestrictedMovementId,
                      groupKey: groupKey,
                    });

                    console.log(
                      `Created consolidated OUT movement from Unrestricted for group ${groupKey}: ${unrestrictedQtyToMove}, ID: ${unrestrictedMovementId}`
                    );
                  }
                }
              }

              // ADDED: Handle unused reserved quantities for the group
              if (isUpdate && prevBaseQty > 0) {
                const deliveredQty = baseQty;
                const originalReservedQty = prevBaseQty;
                const unusedReservedQty = roundQty(
                  originalReservedQty - deliveredQty
                );

                console.log(
                  `Checking for unused reservations for group ${groupKey}:`
                );
                console.log(`  Originally reserved: ${originalReservedQty}`);
                console.log(`  Actually delivered: ${deliveredQty}`);
                console.log(`  Unused reserved: ${unusedReservedQty}`);

                if (unusedReservedQty > 0) {
                  console.log(
                    `Releasing ${unusedReservedQty} unused reserved quantity back to unrestricted for group ${groupKey}`
                  );

                  // Calculate alternative UOM for unused quantity
                  const unusedAltQty = uomConversion
                    ? roundQty(unusedReservedQty / uomConversion.base_qty)
                    : unusedReservedQty;

                  // Create movement to release unused reserved back to unrestricted
                  const releaseReservedMovementData = {
                    ...baseInventoryMovement,
                    movement: "OUT",
                    inventory_category: "Reserved",
                    quantity: unusedAltQty,
                    total_price: roundPrice(unitPrice * unusedAltQty),
                    base_qty: unusedReservedQty,
                  };

                  const returnUnrestrictedMovementData = {
                    ...baseInventoryMovement,
                    movement: "IN",
                    inventory_category: "Unrestricted",
                    quantity: unusedAltQty,
                    total_price: roundPrice(unitPrice * unusedAltQty),
                    base_qty: unusedReservedQty,
                  };

                  // Add the release movements
                  await db
                    .collection("inventory_movement")
                    .add(releaseReservedMovementData);
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const releaseMovementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: data.delivery_no,
                      parent_trx_no: item.line_so_no,
                      movement: "OUT",
                      inventory_category: "Reserved",
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      base_qty: unusedReservedQty,
                      plant_id: plantId,
                      organization_id: organizationId,
                    })
                    .get();

                  if (
                    releaseMovementQuery.data &&
                    releaseMovementQuery.data.length > 0
                  ) {
                    const movementId = releaseMovementQuery.data.sort(
                      (a, b) =>
                        new Date(b.create_time) - new Date(a.create_time)
                    )[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: movementId,
                      groupKey: groupKey,
                    });
                  }

                  await db
                    .collection("inventory_movement")
                    .add(returnUnrestrictedMovementData);
                  await new Promise((resolve) => setTimeout(resolve, 100));

                  const returnMovementQuery = await db
                    .collection("inventory_movement")
                    .where({
                      transaction_type: "GDL",
                      trx_no: data.delivery_no,
                      parent_trx_no: item.line_so_no,
                      movement: "IN",
                      inventory_category: "Unrestricted",
                      item_id: item.material_id,
                      bin_location_id: group.location_id,
                      base_qty: unusedReservedQty,
                      plant_id: plantId,
                      organization_id: organizationId,
                    })
                    .get();

                  if (
                    returnMovementQuery.data &&
                    returnMovementQuery.data.length > 0
                  ) {
                    const movementId = returnMovementQuery.data.sort(
                      (a, b) =>
                        new Date(b.create_time) - new Date(a.create_time)
                    )[0].id;

                    createdDocs.push({
                      collection: "inventory_movement",
                      docId: movementId,
                      groupKey: groupKey,
                    });
                  }

                  console.log(
                    `Created unused reserved release movements for group ${groupKey}: ${unusedReservedQty}`
                  );
                }
              }
            }

            // Create INDIVIDUAL inv_serial_movement records for each serial in the group
            if (isSerializedItem) {
              console.log(
                `Creating inv_serial_movement records for ${group.items.length} serialized items`
              );

              // Use movements created specifically for this group during the above processing
              // Filter movements by exact group key to ensure we only get movements for this specific group
              const currentGroupMovements = createdDocs.filter(
                (doc) =>
                  doc.collection === "inventory_movement" &&
                  doc.groupKey === groupKey // Add groupKey during movement creation
              );

              const outMovements = currentGroupMovements;

              console.log(
                `Found ${outMovements.length} OUT movements to process for serial records`
              );

              // For each movement, create individual inv_serial_movement records for EACH serial number
              for (const movement of outMovements) {
                console.log(`Processing movement ID: ${movement.docId}`);

                // Get the movement details using WHERE query instead of doc()
                const movementQuery = await db
                  .collection("inventory_movement")
                  .where({ id: movement.docId })
                  .get();

                if (
                  movementQuery.data &&
                  movementQuery.data.length > 0 &&
                  movementQuery.data[0].movement === "OUT"
                ) {
                  const movementData = movementQuery.data[0];
                  console.log(
                    `Movement ${movement.docId} confirmed as OUT movement with category: ${movementData.inventory_category}`
                  );

                  // Create one inv_serial_movement record for EACH serial number
                  for (
                    let serialIndex = 0;
                    serialIndex < group.items.length;
                    serialIndex++
                  ) {
                    const temp = group.items[serialIndex];

                    if (temp.serial_number) {
                      console.log(
                        `Processing serial ${serialIndex + 1}/${
                          group.items.length
                        }: ${temp.serial_number}`
                      );

                      // Calculate individual base qty for this serial
                      let individualBaseQty = roundQty(temp.gd_quantity);
                      if (uomConversion) {
                        individualBaseQty = roundQty(
                          individualBaseQty * uomConversion.base_qty
                        );
                      }

                      console.log(
                        `Creating inv_serial_movement for serial ${temp.serial_number}, individual qty: ${individualBaseQty}, movement: ${movement.docId}`
                      );

                      try {
                        await db.collection("inv_serial_movement").add({
                          inventory_movement_id: movement.docId,
                          serial_number: temp.serial_number,
                          batch_id: temp.batch_id || null,
                          base_qty: individualBaseQty,
                          base_uom: baseUOM,
                          plant_id: plantId,
                          organization_id: organizationId,
                        });

                        console.log(
                          `✓ Successfully added inv_serial_movement for serial ${temp.serial_number}`
                        );

                        // Wait and get the created ID for tracking
                        await new Promise((resolve) =>
                          setTimeout(resolve, 100)
                        );

                        const serialMovementQuery = await db
                          .collection("inv_serial_movement")
                          .where({
                            inventory_movement_id: movement.docId,
                            serial_number: temp.serial_number,
                            plant_id: plantId,
                            organization_id: organizationId,
                          })
                          .get();

                        if (
                          serialMovementQuery.data &&
                          serialMovementQuery.data.length > 0
                        ) {
                          const serialMovementId =
                            serialMovementQuery.data.sort(
                              (a, b) =>
                                new Date(b.create_time) -
                                new Date(a.create_time)
                            )[0].id;

                          createdDocs.push({
                            collection: "inv_serial_movement",
                            docId: serialMovementId,
                          });

                          console.log(
                            `✓ Successfully tracked inv_serial_movement record for serial ${temp.serial_number}, ID: ${serialMovementId}`
                          );
                        } else {
                          console.error(
                            `✗ Failed to find created inv_serial_movement record for serial ${temp.serial_number}`
                          );
                        }
                      } catch (serialError) {
                        console.error(
                          `✗ Error creating inv_serial_movement for serial ${temp.serial_number}:`,
                          serialError
                        );
                      }
                    } else {
                      console.warn(
                        `Serial number missing for item at index ${serialIndex}`
                      );
                    }
                  }
                } else {
                  console.error(
                    `Movement ${movement.docId} not found or not an OUT movement using WHERE query`
                  );
                  if (movementQuery.data) {
                    console.error(`Movement query result:`, movementQuery.data);
                  }
                }
              }
              console.log(
                `Completed processing serial movement records for ${group.items.length} serials in group ${groupKey}`
              );
            }

            // Update balances
            if (isSerializedItem) {
              // For serialized items, we need to distribute the deduction proportionally across each serial
              let remainingToDeduct = baseQty;
              let remainingReservedToDeduct = 0;
              let remainingUnrestrictedToDeduct = 0;

              if (gdStatus === "Created") {
                // Determine how much comes from reserved vs unrestricted based on our movement logic
                let availableReservedForThisGD = totalGroupReserved;
                if (isUpdate && prevBaseQty > 0) {
                  availableReservedForThisGD = Math.min(
                    totalGroupReserved,
                    prevBaseQty
                  );
                }

                if (availableReservedForThisGD >= baseQty) {
                  // All from reserved
                  remainingReservedToDeduct = baseQty;
                  remainingUnrestrictedToDeduct = 0;
                } else {
                  // Split between reserved and unrestricted
                  remainingReservedToDeduct = availableReservedForThisGD;
                  remainingUnrestrictedToDeduct = roundQty(
                    baseQty - availableReservedForThisGD
                  );
                }
              }

              console.log(
                `Distributing deduction across serials: Reserved=${remainingReservedToDeduct}, Unrestricted=${remainingUnrestrictedToDeduct}`
              );

              // Process each serial balance individually with proper distribution
              for (const serialBalance of serialBalances) {
                if (remainingToDeduct <= 0) break;

                const serialDoc = serialBalance.balance;
                const currentSerialUnrestricted = serialBalance.unrestricted;
                const currentSerialReserved = serialBalance.reserved;
                const individualBaseQty = serialBalance.individualBaseQty;

                // Calculate how much to deduct from this serial (proportional to its individual quantity)
                const serialDeductionRatio = individualBaseQty / baseQty;
                const serialReservedDeduction = roundQty(
                  remainingReservedToDeduct * serialDeductionRatio
                );
                const serialUnrestrictedDeduction = roundQty(
                  remainingUnrestrictedToDeduct * serialDeductionRatio
                );

                let finalSerialUnrestricted = roundQty(
                  currentSerialUnrestricted - serialUnrestrictedDeduction
                );
                let finalSerialReserved = roundQty(
                  currentSerialReserved - serialReservedDeduction
                );

                // Safety checks to prevent negative values
                if (finalSerialUnrestricted < 0) {
                  console.warn(
                    `Serial ${serialBalance.serial}: Unrestricted would be negative (${finalSerialUnrestricted}), setting to 0`
                  );
                  finalSerialUnrestricted = 0;
                }
                if (finalSerialReserved < 0) {
                  console.warn(
                    `Serial ${serialBalance.serial}: Reserved would be negative (${finalSerialReserved}), setting to 0`
                  );
                  finalSerialReserved = 0;
                }

                const originalData = {
                  unrestricted_qty: currentSerialUnrestricted,
                  reserved_qty: currentSerialReserved,
                };

                const updateData = {
                  unrestricted_qty: finalSerialUnrestricted,
                  reserved_qty: finalSerialReserved,
                };

                if (serialDoc.hasOwnProperty("balance_quantity")) {
                  originalData.balance_quantity = roundQty(
                    currentSerialUnrestricted + currentSerialReserved
                  );
                  updateData.balance_quantity = roundQty(
                    finalSerialUnrestricted + finalSerialReserved
                  );
                }

                updatedDocs.push({
                  collection: "item_serial_balance",
                  docId: serialDoc.id,
                  originalData: originalData,
                });

                try {
                  await db
                    .collection("item_serial_balance")
                    .doc(serialDoc.id)
                    .update(updateData);

                  console.log(
                    `Updated serial balance for ${serialBalance.serial}: ` +
                      `Unrestricted=${finalSerialUnrestricted}, Reserved=${finalSerialReserved}` +
                      (updateData.balance_quantity
                        ? `, Balance=${updateData.balance_quantity}`
                        : "")
                  );

                  remainingToDeduct = roundQty(
                    remainingToDeduct - individualBaseQty
                  );
                } catch (serialBalanceError) {
                  console.error(
                    `Error updating serial balance for ${serialBalance.serial}:`,
                    serialBalanceError
                  );
                  throw serialBalanceError;
                }
              }
            } else if (existingDoc && existingDoc.id) {
              // For non-serialized items, update the consolidated balance
              let currentUnrestrictedQty = roundQty(
                parseFloat(existingDoc.unrestricted_qty || 0)
              );
              let currentReservedQty = roundQty(
                parseFloat(existingDoc.reserved_qty || 0)
              );
              let currentBalanceQty = roundQty(
                parseFloat(existingDoc.balance_quantity || 0)
              );

              // Update balance quantities based on GD status
              let finalUnrestrictedQty = currentUnrestrictedQty;
              let finalReservedQty = currentReservedQty;
              let finalBalanceQty = currentBalanceQty;

              if (gdStatus === "Created") {
                // Apply the smart deduction logic
                let availableReservedForThisGD = currentReservedQty;
                if (isUpdate && prevBaseQty > 0) {
                  availableReservedForThisGD = Math.min(
                    currentReservedQty,
                    prevBaseQty
                  );
                }

                if (availableReservedForThisGD >= baseQty) {
                  // All quantity can come from Reserved
                  finalReservedQty = roundQty(finalReservedQty - baseQty);

                  // Handle unused reservations
                  if (isUpdate && prevBaseQty > 0) {
                    const unusedReservedQty = roundQty(prevBaseQty - baseQty);
                    if (unusedReservedQty > 0) {
                      finalReservedQty = roundQty(
                        finalReservedQty - unusedReservedQty
                      );
                      finalUnrestrictedQty = roundQty(
                        finalUnrestrictedQty + unusedReservedQty
                      );
                    }
                  }
                } else {
                  // Split between Reserved and Unrestricted
                  const reservedDeduction = availableReservedForThisGD;
                  const unrestrictedDeduction = roundQty(
                    baseQty - reservedDeduction
                  );

                  finalReservedQty = roundQty(
                    finalReservedQty - reservedDeduction
                  );
                  finalUnrestrictedQty = roundQty(
                    finalUnrestrictedQty - unrestrictedDeduction
                  );
                }
              }

              finalBalanceQty = roundQty(finalBalanceQty - baseQty);

              console.log(
                `Final quantities after ${gdStatus} processing for group ${groupKey}:`
              );
              console.log(`  Unrestricted: ${finalUnrestrictedQty}`);
              console.log(`  Reserved: ${finalReservedQty}`);
              console.log(`  Total Balance: ${finalBalanceQty}`);

              updatedDocs.push({
                collection: balanceCollection,
                docId: existingDoc.id,
                originalData: {
                  unrestricted_qty: currentUnrestrictedQty,
                  reserved_qty: currentReservedQty,
                  balance_quantity: currentBalanceQty,
                },
              });

              await db
                .collection(balanceCollection)
                .doc(existingDoc.id)
                .update({
                  unrestricted_qty: finalUnrestrictedQty,
                  reserved_qty: finalReservedQty,
                  balance_quantity: finalBalanceQty,
                });

              console.log(`Updated balance for group ${groupKey}`);
            }
          }

          // Update costing method inventories (use total group quantity)
          if (costingMethod === "First In First Out") {
            await updateFIFOInventory(
              item.material_id,
              baseQty,
              group.batch_id,
              plantId
            );
          } else if (costingMethod === "Weighted Average") {
            await updateWeightedAverage(
              item,
              group.batch_id,
              baseWAQty,
              plantId
            );
          }
        }

        console.log(
          `Successfully processed ${groupedTempData.size} consolidated movement groups for item ${item.material_id}`
        );
      }
    } catch (error) {
      console.error(`Error processing item ${item.material_id}:`, error);

      // Rollback changes if any operation fails
      for (const doc of updatedDocs.reverse()) {
        try {
          await db
            .collection(doc.collection)
            .doc(doc.docId)
            .update(doc.originalData);
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }

      for (const doc of createdDocs.reverse()) {
        try {
          await db.collection(doc.collection).doc(doc.docId).update({
            is_deleted: 1,
          });
        } catch (rollbackError) {
          console.error("Rollback error:", rollbackError);
        }
      }

      throw error; // Re-throw to stop processing
    }
  }

  return Promise.resolve();
};

// Enhanced goods delivery status update
const updateSalesOrderStatus = async (salesOrderId, tableGD) => {
  const soIds = Array.isArray(salesOrderId) ? salesOrderId : [salesOrderId];

  // Arrays to collect data for the return format
  let soDataArray = [];

  try {
    const updatePromises = soIds.map(async (salesOrderId) => {
      const filteredGD = tableGD.filter(
        (item) => item.line_so_id === salesOrderId
      );

      const resSO = await db
        .collection("sales_order")
        .where({ id: salesOrderId })
        .get();

      if (!resSO.data || !resSO.data.length) {
        console.log(`Sales order ${salesOrderId} not found`);
        return;
      }

      const soDoc = resSO.data[0];

      const soItems = soDoc.table_so || [];
      if (!soItems.length) {
        console.log(`No items found in sales order ${salesOrderId}`);
        return;
      }

      const filteredSO = soItems
        .map((item, index) => ({ ...item, originalIndex: index }))
        .filter((item) => item.item_name !== "" || item.so_desc !== "")
        .filter((item) =>
          filteredGD.some((gd) => gd.so_line_item_id === item.id)
        );

      // Create a map to sum delivered quantities for each item
      let totalItems = soItems.length;
      let partiallyDeliveredItems = 0;
      let fullyDeliveredItems = 0;

      // Create a copy of the SO items to update later
      const updatedSoItems = JSON.parse(JSON.stringify(soItems));

      filteredSO.forEach((filteredItem, filteredIndex) => {
        const originalIndex = filteredItem.originalIndex;
        const orderedQty = parseFloat(filteredItem.so_quantity || 0);
        const gdDeliveredQty = parseFloat(
          filteredGD[filteredIndex]?.gd_qty || 0
        );
        const currentDeliveredQty = parseFloat(
          updatedSoItems[originalIndex].delivered_qty || 0
        );
        const totalDeliveredQty = currentDeliveredQty + gdDeliveredQty;

        // Update the quantity in the original soItems structure
        updatedSoItems[originalIndex].delivered_qty = totalDeliveredQty;

        const outstandingQty = parseFloat(orderedQty - totalDeliveredQty);
        if (outstandingQty < 0) {
          updatedSoItems[originalIndex].outstanding_quantity = 0;
        } else {
          updatedSoItems[originalIndex].outstanding_quantity = outstandingQty;
        }

        // Add ratio for tracking purposes
        updatedSoItems[originalIndex].delivery_ratio =
          orderedQty > 0 ? totalDeliveredQty / orderedQty : 0;

        // Count items with ANY delivered quantity as "partially delivered"
        if (totalDeliveredQty > 0) {
          partiallyDeliveredItems++;
          updatedSoItems[originalIndex].line_status = "Processing";

          // Count fully delivered items separately
          if (totalDeliveredQty >= orderedQty) {
            fullyDeliveredItems++;
            updatedSoItems[originalIndex].line_status = "Completed";
          }
        }
      });

      // Check item completion status
      let allItemsComplete = fullyDeliveredItems === totalItems;
      let anyItemProcessing = partiallyDeliveredItems > 0;

      // Determine new status
      let newSOStatus = soDoc.so_status;
      let newGDStatus = soDoc.gd_status;

      if (allItemsComplete) {
        newSOStatus = "Completed";
        newGDStatus = "Fully Delivered";
      } else if (anyItemProcessing) {
        newSOStatus = "Processing";
        newGDStatus = "Partially Delivered";
      }

      // Create tracking ratios
      const partiallyDeliveredRatio = `${partiallyDeliveredItems} / ${totalItems}`;
      const fullyDeliveredRatio = `${fullyDeliveredItems} / ${totalItems}`;

      console.log(`SO ${salesOrderId} status:
        Total items: ${totalItems}
        Partially delivered items (including fully delivered): ${partiallyDeliveredItems} (${partiallyDeliveredRatio})
        Fully delivered items: ${fullyDeliveredItems} (${fullyDeliveredRatio})
      `);

      // Prepare a single update operation with all changes
      const updateData = {
        table_so: updatedSoItems,
        partially_delivered: partiallyDeliveredRatio,
        fully_delivered: fullyDeliveredRatio,
      };

      // Only include status changes if needed
      if (newSOStatus !== soDoc.so_status) {
        updateData.so_status = newSOStatus;
      }

      if (newGDStatus !== soDoc.gd_status) {
        updateData.gd_status = newGDStatus;
      }

      // Execute a single database update
      await db.collection("sales_order").doc(soDoc.id).update(updateData);

      const originalSOStatus = soDoc.so_status;
      // Log the status change if it occurred
      if (newSOStatus !== originalSOStatus) {
        console.log(
          `Updated SO ${salesOrderId} status from ${originalSOStatus} to ${newSOStatus}`
        );
      }
      return {
        soId: salesOrderId,
        newSOStatus,
        totalItems,
        partiallyDeliveredItems,
        fullyDeliveredItems,
        success: true,
      };
    });

    const results = await Promise.all(updatePromises);

    results.forEach((result) => {
      if (result && result.success) {
        // Add PO data
        soDataArray.push({
          so_id: result.soId,
          status: result.newSOStatus,
        });
      }
    });

    // Aggregate results for logging
    const successCount = results.filter((r) => r && r.success).length;
    const failCount = results.filter((r) => r && !r.success).length;

    console.log(`SO Status Update Summary: 
      Total SOs: ${soIds.length}
      Successfully updated: ${successCount}
      Failed updates: ${failCount}
    `);

    // Return in the requested format
    return {
      so_data_array: soDataArray,
    };
  } catch (error) {
    console.error(`Error in update sales order status process:`, error);
    return {
      so_data_array: [],
    };
  }
};

// Updated updateOnReserveGoodsDelivery function for Completed status with serial support
const updateOnReserveGoodsDelivery = async (organizationId, gdData) => {
  try {
    console.log(
      "Updating on_reserved_gd records for delivery (including serialized items):",
      gdData.delivery_no
    );

    // Helper function to safely parse JSON
    const parseJsonSafely = (jsonString, defaultValue = []) => {
      try {
        return jsonString ? JSON.parse(jsonString) : defaultValue;
      } catch (error) {
        console.error("JSON parse error:", error);
        return defaultValue;
      }
    };

    // Get existing records for this GD
    const existingReserved = await db
      .collection("on_reserved_gd")
      .where({
        doc_no: gdData.delivery_no,
        organization_id: organizationId,
      })
      .get();

    // Prepare new data from current GD (including serialized items)
    const newReservedData = [];
    for (let i = 0; i < gdData.table_gd.length; i++) {
      const gdLineItem = gdData.table_gd[i];

      if (!gdLineItem.material_id || gdLineItem.material_id === "") {
        console.log(
          `Skipping item ${gdLineItem.material_id} due to no material_id`
        );
        continue;
      }

      const temp_qty_data = parseJsonSafely(gdLineItem.temp_qty_data);
      for (let j = 0; j < temp_qty_data.length; j++) {
        const tempItem = temp_qty_data[j];

        const reservedRecord = {
          doc_type: "Good Delivery",
          parent_no: gdLineItem.line_so_no,
          doc_no: gdData.delivery_no,
          material_id: gdLineItem.material_id,
          item_name: gdLineItem.material_name,
          item_desc: gdLineItem.gd_material_desc || "",
          batch_id: tempItem.batch_id || null,
          bin_location: tempItem.location_id,
          item_uom: gdLineItem.gd_order_uom_id,
          line_no: i + 1,
          reserved_qty: tempItem.gd_quantity,
          delivered_qty: tempItem.gd_quantity, // For Completed status, delivered = reserved
          open_qty: 0, // For Completed status, open_qty = 0
          reserved_date: new Date()
            .toISOString()
            .slice(0, 19)
            .replace("T", " "),
          plant_id: gdData.plant_id.id,
          organization_id: organizationId,
          updated_by: this.getVarGlobal("nickname"),
          updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        };

        // Add serial number for serialized items
        if (tempItem.serial_number) {
          reservedRecord.serial_number = tempItem.serial_number;
        }

        newReservedData.push(reservedRecord);
      }
    }

    if (existingReserved.data && existingReserved.data.length > 0) {
      console.log(
        `Found ${existingReserved.data.length} existing reserved records to update (including serialized items)`
      );

      const updatePromises = [];

      // Update existing records (up to the number of existing records)
      for (
        let i = 0;
        i < Math.min(existingReserved.data.length, newReservedData.length);
        i++
      ) {
        const existingRecord = existingReserved.data[i];
        const newData = newReservedData[i];

        updatePromises.push(
          db.collection("on_reserved_gd").doc(existingRecord.id).update(newData)
        );
      }

      // If there are more existing records than new data, delete the extras
      if (existingReserved.data.length > newReservedData.length) {
        for (
          let i = newReservedData.length;
          i < existingReserved.data.length;
          i++
        ) {
          const extraRecord = existingReserved.data[i];
          updatePromises.push(
            db.collection("on_reserved_gd").doc(extraRecord.id).delete()
          );
        }
      }

      // If there are more new records than existing, create the extras
      if (newReservedData.length > existingReserved.data.length) {
        for (
          let i = existingReserved.data.length;
          i < newReservedData.length;
          i++
        ) {
          const extraData = {
            ...newReservedData[i],
            created_by: this.getVarGlobal("nickname"),
            created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          };
          updatePromises.push(db.collection("on_reserved_gd").add(extraData));
        }
      }

      await Promise.all(updatePromises);
      console.log(
        "Successfully updated existing reserved records (including serialized items)"
      );
    } else {
      // No existing records, create new ones
      console.log(
        "No existing records found, creating new ones (including serialized items)"
      );

      const createPromises = newReservedData.map((data) => {
        return db.collection("on_reserved_gd").add({
          ...data,
          created_by: this.getVarGlobal("nickname"),
          created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        });
      });

      await Promise.all(createPromises);
      console.log(
        `Created ${newReservedData.length} new reserved goods records (including serialized items)`
      );
    }

    console.log(
      "Updated reserved goods records successfully (including serialized items)"
    );
  } catch (error) {
    console.error(
      "Error updating reserved goods delivery (serialized items):",
      error
    );
    throw error;
  }
};

const fillbackHeaderFields = async (gd) => {
  try {
    for (const [index, gdLineItem] of gd.table_gd.entries()) {
      gdLineItem.customer_id = gd.customer_name.id || null;
      gdLineItem.organization_id = gd.organization_id;
      gdLineItem.plant_id = gd.plant_id.id || null;
      gdLineItem.billing_state_id = gd.billing_address_state.id || null;
      gdLineItem.billing_country_id = gd.billing_address_country.id || null;
      gdLineItem.shipping_state_id = gd.shipping_address_state.id || null;
      gdLineItem.shipping_country_id = gd.shipping_address_country.id || null;
      gdLineItem.assigned_to =
        gd.assigned_to.length > 0 ? gd.assigned_to.map((item) => item.id) : [];
      gdLineItem.line_index = index + 1;
    }
    return gd.table_gd;
  } catch {
    throw new Error("Error processing goods delivery.");
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    const allListID = "custom_ezwb0qqp";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      let goodsDeliveryData = selectedRecords.filter(
        (item) => item.gd_status === "Created"
      );

      if (goodsDeliveryData.length === 0) {
        this.$message.error(
          "Please select at least one created goods delivery."
        );
        return;
      }

      // PRE-VALIDATION: Check inventory availability before showing confirmation
      console.log("Starting bulk inventory validation before confirmation...");
      const bulkValidationResult = await validateBulkInventoryAvailability(
        goodsDeliveryData
      );

      let validGoodsDeliveryData = goodsDeliveryData;
      let removedGDs = [];

      if (!bulkValidationResult.isValid) {
        // Get list of GD numbers with validation errors
        const failedGDNumbers = new Set(
          bulkValidationResult.errors.map((error) => error.gdNo)
        );

        // Filter out failed GDs and keep only passing ones
        validGoodsDeliveryData = goodsDeliveryData.filter(
          (gdItem) => !failedGDNumbers.has(gdItem.delivery_no)
        );

        // Track removed GDs for user notification
        removedGDs = goodsDeliveryData.filter((gdItem) =>
          failedGDNumbers.has(gdItem.delivery_no)
        );

        console.log(
          `Found ${removedGDs.length} GDs with validation errors, ${validGoodsDeliveryData.length} GDs passed validation`
        );

        // Format error message for display - ALWAYS show this alert for failed GDs
        const errorsByGD = {};
        bulkValidationResult.errors.forEach((error) => {
          if (!errorsByGD[error.gdNo]) {
            errorsByGD[error.gdNo] = [];
          }
          errorsByGD[error.gdNo].push(error.error);
        });

        let detailedErrorMsg = `<strong>${bulkValidationResult.summary}</strong><br><br>`;
        detailedErrorMsg += `<strong>The following goods deliveries cannot be processed:</strong><br>`;

        for (const [gdNo, errors] of Object.entries(errorsByGD)) {
          detailedErrorMsg += `<br><strong>GD ${gdNo}:</strong><br>`;
          errors.forEach((error) => {
            detailedErrorMsg += `• ${error}<br>`;
          });
        }

        if (validGoodsDeliveryData.length > 0) {
          detailedErrorMsg += `<br><strong>Remaining ${validGoodsDeliveryData.length} GD(s) will continue to confirmation.</strong>`;
        } else {
          detailedErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for failed GDs
        await this.$alert(detailedErrorMsg, "Inventory Validation Issues", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });

        // If no valid GDs remain, exit after showing the alert
        if (validGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Bulk inventory validation completed - proceeding to delivery quantity validation with ${validGoodsDeliveryData.length} valid GDs`
      );

      // Run delivery quantity validation on remaining valid GDs
      const deliveryQuantityValidationResult =
        await checkBulkDeliveryQuantities(validGoodsDeliveryData);

      // Filter GDs that passed inventory and delivery quantity validation
      let quantityValidGoodsDeliveryData = validGoodsDeliveryData;

      if (!deliveryQuantityValidationResult.allPassed) {
        // Group failed line items by GD number
        const failedGDMap = new Map();
        deliveryQuantityValidationResult.failedGDs.forEach((issue) => {
          if (!failedGDMap.has(issue.gdNo)) {
            failedGDMap.set(issue.gdNo, []);
          }
          failedGDMap.get(issue.gdNo).push(issue);
        });

        // Filter out GDs that have any failed line items
        const quantityFailedGDNumbers = Array.from(failedGDMap.keys());
        quantityValidGoodsDeliveryData = validGoodsDeliveryData.filter(
          (gd) => !quantityFailedGDNumbers.includes(gd.delivery_no)
        );

        // Prepare delivery quantity error message
        let quantityErrorMsg = `<strong>Delivery Quantity Validation Issues</strong><br><br>`;
        quantityErrorMsg += `<strong>The following goods deliveries have items exceeding maximum deliverable quantities:</strong><br>`;

        for (const [gdNo, issues] of failedGDMap) {
          quantityErrorMsg += `<br><strong>GD ${gdNo}:</strong><br>`;
          issues.forEach((issue) => {
            quantityErrorMsg += `• Line ${issue.lineNumber} - ${issue.materialName}: `;
            quantityErrorMsg += `Delivery Qty ${
              issue.currentDeliveryQty
            } > Max ${issue.maxDeliverableQty.toFixed(3)} `;
            quantityErrorMsg += `(Tolerance: ${issue.tolerance}%)<br>`;
          });
        }

        if (quantityValidGoodsDeliveryData.length > 0) {
          quantityErrorMsg += `<br><strong>Remaining ${quantityValidGoodsDeliveryData.length} GD(s) will continue to picking validation.</strong>`;
        } else {
          quantityErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for delivery quantity failed GDs
        await this.$alert(
          quantityErrorMsg,
          "Delivery Quantity Validation Issues",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        );

        // If no valid GDs remain after delivery quantity validation, exit
        if (quantityValidGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Delivery quantity validation completed - proceeding to picking validation with ${quantityValidGoodsDeliveryData.length} valid GDs`
      );

      // Run picking status validation on remaining valid GDs
      const pickingValidationResult = await checkBulkPickingStatus(
        quantityValidGoodsDeliveryData
      );

      // Filter GDs that passed inventory, delivery quantity, and picking validation
      let pickingValidGoodsDeliveryData = quantityValidGoodsDeliveryData;

      if (!pickingValidationResult.allPassed) {
        // Filter out GDs that failed picking validation
        const pickingFailedGDNumbers = pickingValidationResult.failedGDs.map(
          (gd) => gd.gdNo
        );
        pickingValidGoodsDeliveryData = validGoodsDeliveryData.filter(
          (gd) => !pickingFailedGDNumbers.includes(gd.delivery_no)
        );

        // Prepare picking error message
        let pickingErrorMsg = `<strong>Picking Validation Issues</strong><br><br>`;
        pickingErrorMsg += `<strong>The following goods deliveries require completed picking process:</strong><br>`;

        for (const failedGD of pickingValidationResult.failedGDs) {
          pickingErrorMsg += `<br><strong>GD ${failedGD.gdNo}:</strong><br>`;
          if (failedGD.plantId) {
            pickingErrorMsg += `• Plant: ${failedGD.plantId}<br>`;
          }
          if (failedGD.currentStatus) {
            pickingErrorMsg += `• Current Picking Status: ${failedGD.currentStatus}<br>`;
          }
          pickingErrorMsg += `• ${failedGD.issue}<br>`;
        }

        if (pickingValidGoodsDeliveryData.length > 0) {
          pickingErrorMsg += `<br><strong>Remaining ${pickingValidGoodsDeliveryData.length} GD(s) will continue to credit limit validation.</strong>`;
        } else {
          pickingErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for picking failed GDs
        await this.$alert(pickingErrorMsg, "Picking Validation Issues", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });

        // If no valid GDs remain after picking validation, exit
        if (pickingValidGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Picking validation completed - proceeding to reserved goods conflict check with ${pickingValidGoodsDeliveryData.length} valid GDs`
      );

      // Run reserved goods conflict check on remaining valid GDs
      const reservedGoodsValidationResult =
        await checkBulkExistingReservedGoods(
          pickingValidGoodsDeliveryData,
          pickingValidGoodsDeliveryData[0]?.organization_id
        );

      // Filter GDs that passed inventory, picking, and reserved goods validation
      let reservedGoodsValidGoodsDeliveryData = pickingValidGoodsDeliveryData;

      if (!reservedGoodsValidationResult.allPassed) {
        // Filter out GDs that failed reserved goods conflict check
        const reservedFailedGDNumbers =
          reservedGoodsValidationResult.failedGDs.map((gd) => gd.gdNo);
        reservedGoodsValidGoodsDeliveryData =
          pickingValidGoodsDeliveryData.filter(
            (gd) => !reservedFailedGDNumbers.includes(gd.delivery_no)
          );

        // Prepare reserved goods conflict error message
        let reservedErrorMsg = `<strong>Reserved Goods Conflict Issues</strong><br><br>`;
        reservedErrorMsg += `<strong>The following goods deliveries have conflicts with other GDs:</strong><br>`;

        for (const failedGD of reservedGoodsValidationResult.failedGDs) {
          reservedErrorMsg += `<br><strong>GD ${failedGD.gdNo}:</strong><br>`;
          reservedErrorMsg += `• Conflicting SO: ${failedGD.conflictingSoNo}<br>`;
          reservedErrorMsg += `• Conflicting GD: ${failedGD.conflictingGdNo}<br>`;
          if (failedGD.openQty) {
            reservedErrorMsg += `• Open Quantity: ${failedGD.openQty}<br>`;
          }
          reservedErrorMsg += `• ${failedGD.issue}<br>`;
        }

        if (reservedGoodsValidGoodsDeliveryData.length > 0) {
          reservedErrorMsg += `<br><strong>Remaining ${reservedGoodsValidGoodsDeliveryData.length} GD(s) will continue to credit limit validation.</strong>`;
        } else {
          reservedErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for reserved goods conflict failed GDs
        await this.$alert(reservedErrorMsg, "Reserved Goods Conflict Issues", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });

        // If no valid GDs remain after reserved goods validation, exit
        if (reservedGoodsValidGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Reserved goods conflict check completed - proceeding to credit limit validation with ${reservedGoodsValidGoodsDeliveryData.length} valid GDs`
      );

      // Run credit limit validation on remaining valid GDs
      const creditLimitValidationResult = await validateBulkCreditLimits(
        reservedGoodsValidGoodsDeliveryData
      );

      console.log(
        "Credit limit validation result:",
        creditLimitValidationResult
      );

      // Filter GDs that passed inventory, picking, reserved goods, and credit limit validation
      let finalValidGoodsDeliveryData = reservedGoodsValidGoodsDeliveryData;

      if (!creditLimitValidationResult.isValid) {
        // Filter out GDs that failed credit limit validation
        const creditFailedGDNumbers = creditLimitValidationResult.errors.map(
          (error) => error.gdNo
        );
        finalValidGoodsDeliveryData = validGoodsDeliveryData.filter(
          (gd) => !creditFailedGDNumbers.includes(gd.delivery_no)
        );

        // Prepare credit limit error message
        let creditErrorMsg = `<strong>Credit Limit Validation Issues</strong><br><br>`;
        creditErrorMsg += `<strong>The following goods deliveries failed credit limit validation:</strong><br>`;

        for (const failedError of creditLimitValidationResult.errors) {
          creditErrorMsg += `<br><strong>GD ${failedError.gdNo}:</strong><br>`;
          creditErrorMsg += `• Customer: ${failedError.customerName}<br>`;
          creditErrorMsg += `• ${failedError.error}<br>`;
        }

        if (finalValidGoodsDeliveryData.length > 0) {
          creditErrorMsg += `<br><strong>Remaining ${finalValidGoodsDeliveryData.length} GD(s) will continue to confirmation.</strong>`;
        } else {
          creditErrorMsg += `<br><strong>No valid GDs remaining to process.</strong>`;
        }

        // Show alert for credit limit failed GDs
        await this.$alert(creditErrorMsg, "Credit Limit Validation Issues", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });

        // If no valid GDs remain after credit limit validation, exit
        if (finalValidGoodsDeliveryData.length === 0) {
          return;
        }
      }

      console.log(
        `Credit limit validation completed - proceeding to confirmation with ${finalValidGoodsDeliveryData.length} valid GDs`
      );

      // Update goods delivery numbers list for confirmation
      const validGoodsDeliveryNumbers = finalValidGoodsDeliveryData.map(
        (item) => item.delivery_no
      );

      // Prepare confirmation message
      let confirmationMessage = `You've selected ${validGoodsDeliveryNumbers.length} goods delivery(s) to complete.<br><br>`;
      confirmationMessage += `<strong>Goods Delivery Numbers:</strong><br>${validGoodsDeliveryNumbers.join(
        ", "
      )}`;
      confirmationMessage += `<br><br><strong>✅ Inventory validation passed</strong><br><strong>✅ Delivery quantity validation passed</strong><br><strong>✅ Picking validation passed</strong><br><strong>✅ Reserved goods conflict check passed</strong><br><strong>✅ Credit limit validation passed</strong><br><br>Do you want to proceed?`;

      await this.$confirm(confirmationMessage, "Goods Delivery Completion", {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      }).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      for (const gdItem of finalValidGoodsDeliveryData) {
        const goodsDeliveryId = gdItem.id;
        await updateEntryWithValidation(
          gdItem.organization_id,
          gdItem,
          "Created",
          goodsDeliveryId
        );
        await updateOnReserveGoodsDelivery(gdItem.organization_id, gdItem);
      }

      await this.$message.success(
        `Successfully completed ${finalValidGoodsDeliveryData.length} goods delivery(s).`
      );
      this.refresh();
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error("Bulk completion error:", error);
  }
})();
