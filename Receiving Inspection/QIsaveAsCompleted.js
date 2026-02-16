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

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

const validateForm = (data, requiredFields, table_insp_mat) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value)) {
        missingFields.push(field.label);
      }
      return;
    }

    // Handle array fields
    if (!Array.isArray(value)) {
      missingFields.push(`${field.label}`);
      return;
    }

    if (value.length === 0) {
      missingFields.push(`${field.label}`);
      return;
    }

    // Check each item in the array
    if (field.arrayType === "object" && field.arrayFields) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue)) {
            missingFields.push(
              `${subField.label} (in ${field.label} #${index + 1})`,
            );
          }
        });
      });
    }

    for (const [index, item] of table_insp_mat.entries()) {
      if (item.passed_qty + item.failed_qty !== item.received_qty) {
        missingFields.push(
          `Total quantity of ${index} must be equals to received quantity.`,
        );
      } else if (item.passed_qty + item.failed_qty === 0) {
        missingFields.push(
          `Total quantity of ${index} must be equals to received quantity.`,
        );
      }
    }
  });

  return missingFields;
};

const validateField = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const getPrefixData = async (organizationId, documentTypes) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: documentTypes,
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber, documentTypes) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: documentTypes,
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
  } catch (error) {
    this.$message.error(error);
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  let generated = prefixData.current_prefix_config;
  generated = generated.replace("prefix", prefixData.prefix_value);
  generated = generated.replace("suffix", prefixData.suffix_value);
  generated = generated.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0"),
  );
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(runNumber).padStart(prefixData.padding_zeroes, "0"),
  );
  return generated;
};

const checkUniqueness = async (
  generatedPrefix,
  organizationId,
  documentTypes,
) => {
  if (documentTypes === "Receiving Inspection") {
    const existingDoc = await db
      .collection("basic_inspection_lot")
      .where({
        inspection_lot_no: generatedPrefix,
        organization_id: organizationId,
      })
      .get();
    return existingDoc.data[0] ? false : true;
  } else if (documentTypes === "Transfer Order (Putaway)") {
    const existingDoc = await db
      .collection("transfer_order_putaway")
      .where({ to_id: generatedPrefix, organization_id: organizationId })
      .get();
    return existingDoc.data[0] ? false : true;
  }
};

const findUniquePrefix = async (prefixData, organizationId, documentTypes) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(
      prefixToShow,
      organizationId,
      documentTypes,
    );
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      `Could not generate a unique ${documentTypes} number after maximum attempts`,
    );
  }

  return { prefixToShow, runningNumber };
};

const addInventoryMovementData = async (
  data,
  invCategory,
  movementType,
  itemData,
  matData,
  quantity,
) => {
  try {
    let basedQty = 0;
    let inspQuantity = quantity;

    if (matData.received_uom !== itemData.based_uom) {
      for (const uom of itemData.table_uom_conversion) {
        if (matData.received_uom === uom.alt_uom_id) {
          basedQty = roundQty(inspQuantity * uom.base_qty);
        }
      }
    } else if (matData.received_uom === itemData.based_uom) {
      basedQty = inspQuantity;
    }

    const actualQty = movementType === "OUT" ? -inspQuantity : inspQuantity;
    const actualBasedQty = movementType === "OUT" ? -basedQty : basedQty;

    const inventoryMovementData = {
      transaction_type: "QI - RI",
      trx_no: data.inspection_lot_no,
      inventory_category: invCategory,
      parent_trx_no: data.gr_no_display,
      movement: movementType,
      unit_price: roundPrice(matData.unit_price),
      total_price: roundPrice(matData.unit_price * basedQty),
      quantity: inspQuantity,
      base_qty: roundQty(basedQty),
      uom_id: matData.received_uom,
      base_uom_id: itemData.based_uom,
      item_id: matData.item_id,
      bin_location_id: matData.location_id,
      batch_number_id: matData.batch_id,
      costing_method_id: itemData.material_costing_method,
      plant_id: data.plant_id,
      organization_id: data.organization_id,
      actual_qty: actualQty,
      actual_base_qty: actualBasedQty,
    };

    await db.collection("inventory_movement").add(inventoryMovementData);
  } catch {
    throw new Error("Error in creating inventory movement.");
  }
};

const createPutAway = async (data, organizationId) => {
  try {
    const prefixData = await getPrefixData(
      organizationId,
      "Transfer Order (Putaway)",
    );
    let putAwayPrefix = "";

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Transfer Order (Putaway)",
      );

      await updatePrefix(
        organizationId,
        runningNumber,
        "Transfer Order (Putaway)",
      );

      putAwayPrefix = prefixToShow;
    }

    let grId = null;
    const resGR = await db
      .collection("goods_receiving")
      .where({ id: data.goods_receiving_no, organization_id: organizationId })
      .get();

    if (resGR && resGR.data[0]) {
      grId = resGR.data[0].id;
    }

    const putAwayLineItemData = [];

    for (const [index, item] of data.table_insp_mat.entries()) {
      // Check if this is a serialized item
      if (item.is_serialized_item === 1 && item.serial_number_data) {
        // Handle serialized items with individual serial numbers
        let serialData;
        try {
          serialData = JSON.parse(item.serial_number_data);
        } catch (parseError) {
          console.error(
            "Error parsing serial number data for putaway:",
            parseError,
          );
          continue;
        }

        if (
          serialData.table_serial_number &&
          Array.isArray(serialData.table_serial_number)
        ) {
          // Group serial numbers by passed status
          const passedSerials = serialData.table_serial_number.filter(
            (serial) => serial.passed === 1,
          );
          const failedSerials = serialData.table_serial_number.filter(
            (serial) => serial.passed === 0,
          );

          // Create grouped putaway entry for failed serials (to Blocked)
          if (failedSerials.length > 0) {
            const failedSerialNumbers = failedSerials
              .map((serial) => serial.system_serial_number)
              .join(", ");

            const blockItemData = {
              line_index: putAwayLineItemData.length + 1,
              item_code: item.item_id,
              item_name: item.item_name,
              item_desc: item.item_desc,
              batch_no: item.batch_id || "",
              source_inv_category: "In Transit",
              target_inv_category: "Blocked",
              received_qty: failedSerials.length,
              item_uom: item.received_uom,
              source_bin: item.location_id,
              qty_to_putaway: failedSerials.length,
              pending_process_qty: failedSerials.length,
              putaway_qty: 0,
              target_location: "",
              remark: `Failed inspection - ${failedSerials.length} units`,
              line_status: "Open",
              po_no: "",
              is_split: "No",
              parent_or_child: "Parent",
              parent_index: putAwayLineItemData.length,
              unit_price: item.unit_price,
              total_price: item.unit_price * failedSerials.length,
              qi_no: this.getValue("id"),
              serial_numbers: failedSerialNumbers,
            };

            putAwayLineItemData.push(blockItemData);
          }

          // Create grouped putaway entry for passed serials (to Unrestricted)
          if (passedSerials.length > 0) {
            const passedSerialNumbers = passedSerials
              .map((serial) => serial.system_serial_number)
              .join(", ");

            const unrestrictedItemData = {
              line_index: putAwayLineItemData.length + 1,
              item_code: item.item_id,
              item_name: item.item_name,
              item_desc: item.item_desc,
              batch_no: item.batch_id || "",
              source_inv_category: "In Transit",
              target_inv_category: "Unrestricted",
              received_qty: passedSerials.length,
              item_uom: item.received_uom,
              source_bin: item.location_id,
              qty_to_putaway: passedSerials.length,
              pending_process_qty: passedSerials.length,
              putaway_qty: 0,
              target_location: "",
              remark: `Passed inspection - ${passedSerials.length} units`,
              line_status: "Open",
              po_no: "",
              is_split: "No",
              parent_or_child: "Parent",
              parent_index: putAwayLineItemData.length,
              unit_price: item.unit_price,
              total_price: item.unit_price * passedSerials.length,
              qi_no: this.getValue("id"),
              serial_numbers: passedSerialNumbers,
            };

            putAwayLineItemData.push(unrestrictedItemData);
          }
        }
      } else {
        // Handle non-serialized items as before
        if (item.failed_qty > 0) {
          const blockItemData = {
            line_index: index + 1,
            item_code: item.item_id,
            item_name: item.item_name,
            item_desc: item.item_desc,
            batch_no: item.batch_id || "",
            source_inv_category: "In Transit",
            target_inv_category: "Blocked",
            received_qty: item.failed_qty,
            item_uom: item.received_uom,
            source_bin: item.location_id,
            qty_to_putaway: item.failed_qty,
            pending_process_qty: item.failed_qty,
            putaway_qty: 0,
            target_location: "",
            remark: "",
            line_status: "Open",
            po_no: "",
            is_split: "No",
            parent_or_child: "Parent",
            parent_index: index,
            unit_price: item.unit_price,
            total_price: item.total_price,
            qi_no: this.getValue("id"),
          };

          putAwayLineItemData.push(blockItemData);
        }

        if (item.passed_qty > 0) {
          const unrestrictedItemData = {
            line_index: index + 1,
            item_code: item.item_id,
            item_name: item.item_name,
            item_desc: item.item_desc,
            batch_no: item.batch_id || "",
            source_inv_category: "In Transit",
            target_inv_category: "Unrestricted",
            received_qty: item.passed_qty,
            item_uom: item.received_uom,
            source_bin: item.location_id,
            qty_to_putaway: item.passed_qty,
            pending_process_qty: item.passed_qty,
            putaway_qty: 0,
            target_location: "",
            remark: "",
            line_status: "Open",
            po_no: "",
            is_split: "No",
            parent_or_child: "Parent",
            parent_index: index,
            unit_price: item.unit_price,
            total_price: item.total_price,
            qi_no: this.getValue("id"),
          };

          putAwayLineItemData.push(unrestrictedItemData);
        }
      }
    }

    console.log("putAwayLineItemData", putAwayLineItemData);

    const putawayData = {
      plant_id: data.plant_id,
      to_id: putAwayPrefix,
      movement_type: "Putaway",
      ref_doc_type: "Goods Receiving",
      gr_no: grId,
      receiving_no: data.gr_no_display,
      supplier_id: resGR?.data[0]?.supplier_name,
      created_by: "System",
      created_at: new Date().toISOString().split("T")[0],
      organization_id: organizationId,
      to_status: "Created",
      table_putaway_item: putAwayLineItemData,
      quality_insp_no: data.inspection_lot_no,
      qi_id: this.getValue("id"),
    };

    const resCurrentPutaway = await db
      .collection("transfer_order_putaway")
      .where({ gr_no: grId, to_status: "Created", is_deleted: 0 })
      .get();

    if (resCurrentPutaway && resCurrentPutaway.data.length > 0) {
      const currentPutaway = resCurrentPutaway.data[0];

      const latestPutawayItem = [
        ...(currentPutaway.table_putaway_item || []),
        ...putAwayLineItemData,
      ];

      for (const [index, _putaway] of latestPutawayItem.entries()) {
        latestPutawayItem[index].line_index = index + 1;
        latestPutawayItem[index].parent_index = index;
      }

      currentPutaway.table_putaway_item = latestPutawayItem;

      await db
        .collection("transfer_order_putaway")
        .doc(currentPutaway.id)
        .update(currentPutaway);
    } else {
      await db.collection("transfer_order_putaway").add(putawayData);
    }

    await db
      .collection("goods_receiving")
      .where({ id: grId })
      .update({ putaway_status: "Created" });
  } catch {
    throw new Error("Error creating putaway.");
  }
};

const processSerializedItemMovements = async (
  data,
  mat,
  itemData,
  putAwayRequired,
) => {
  try {
    if (!mat.serial_number_data) {
      console.log(`No serial number data for item ${mat.item_id}`);
      return;
    }

    let serialData;
    try {
      serialData = JSON.parse(mat.serial_number_data);
    } catch (parseError) {
      console.error("Error parsing serial number data:", parseError);
      return;
    }

    if (
      !serialData.table_serial_number ||
      !Array.isArray(serialData.table_serial_number)
    ) {
      console.log(`No serial number table for item ${mat.item_id}`);
      return;
    }

    // Filter out invalid serial numbers
    const validSerials = serialData.table_serial_number.filter(
      (serialItem) =>
        serialItem.system_serial_number &&
        serialItem.system_serial_number !== "Auto generated serial number",
    );

    if (validSerials.length === 0) {
      console.warn(`No valid serial numbers found for item ${mat.item_id}`);
      return;
    }

    // Group serials by target category for inventory movement grouping
    const serialGroups = new Map();

    // Create OUT movement group (all serials from Quality Inspection)
    const outGroupKey = `${mat.item_id}_${mat.location_id}_${mat.batch_id}_QualityInspection_OUT`;
    serialGroups.set(outGroupKey, {
      category: "Quality Inspection",
      movement: "OUT",
      serials: [...validSerials],
      targetQtyField: "qualityinsp_qty",
      operation: "subtract",
    });

    // Group serials by passed status for IN movements
    const passedSerials = validSerials.filter((serial) => serial.passed === 1);
    const failedSerials = validSerials.filter((serial) => serial.passed === 0);

    if (passedSerials.length > 0) {
      const passedCategory =
        putAwayRequired === 1 ? "In Transit" : "Unrestricted";
      const passedGroupKey = `${mat.item_id}_${mat.location_id}_${mat.batch_id}_${passedCategory}_IN`;
      serialGroups.set(passedGroupKey, {
        category: passedCategory,
        movement: "IN",
        serials: passedSerials,
        targetQtyField:
          putAwayRequired === 1 ? "intransit_qty" : "unrestricted_qty",
        operation: "add",
      });
    }

    if (failedSerials.length > 0) {
      const failedCategory = putAwayRequired === 1 ? "In Transit" : "Blocked";
      const failedGroupKey = `${mat.item_id}_${mat.location_id}_${mat.batch_id}_${failedCategory}_IN`;
      serialGroups.set(failedGroupKey, {
        category: failedCategory,
        movement: "IN",
        serials: failedSerials,
        targetQtyField: putAwayRequired === 1 ? "intransit_qty" : "block_qty",
        operation: "add",
      });
    }

    // Process each group and create grouped inventory movements
    for (const group of serialGroups.values()) {
      if (group.serials.length === 0) continue;

      const totalQuantity = group.serials.length;
      const totalPrice = roundPrice(mat.unit_price * totalQuantity);

      const actualQty =
        group.movement === "OUT" ? -totalQuantity : totalQuantity;
      const actualBasedQty =
        group.movement === "OUT" ? -totalQuantity : totalQuantity;

      // Create grouped inventory movement
      const inventoryMovementData = {
        transaction_type: "QI - RI",
        trx_no: data.inspection_lot_no,
        inventory_category: group.category,
        parent_trx_no: data.gr_no_display,
        movement: group.movement,
        unit_price: roundPrice(mat.unit_price),
        total_price: totalPrice,
        quantity: totalQuantity,
        base_qty: roundQty(totalQuantity),
        uom_id: mat.received_uom,
        base_uom_id: itemData.based_uom,
        item_id: mat.item_id,
        bin_location_id: mat.location_id,
        batch_number_id: mat.batch_id,
        costing_method_id: itemData.material_costing_method,
        plant_id: data.plant_id,
        organization_id: data.organization_id,
        actual_qty: actualQty,
        actual_base_qty: actualBasedQty,
      };

      const inventoryMovementResult = await db
        .collection("inventory_movement")
        .add(inventoryMovementData);

      // Add small delay and fetch the actual ID
      await new Promise((resolve) => setTimeout(resolve, 100));
      const fetchedMovement = await db
        .collection("inventory_movement")
        .where({
          transaction_type: "QI - RI",
          trx_no: data.inspection_lot_no,
          inventory_category: group.category,
          movement: group.movement,
          item_id: mat.item_id,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
        })
        .get();

      const actualMovementId =
        fetchedMovement?.data?.[fetchedMovement.data.length - 1]?.id ||
        inventoryMovementResult.id;

      console.log(
        `Created grouped ${group.movement} inventory movement for ${totalQuantity} serials in ${group.category}`,
      );

      // Create individual serial movement records for each serial in the group
      for (const serialItem of group.serials) {
        await db.collection("inv_serial_movement").add({
          inventory_movement_id: actualMovementId,
          serial_number: serialItem.system_serial_number,
          batch_id: mat.batch_id,
          base_qty: roundQty(1),
          base_uom: itemData.based_uom,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
        });

        // Update item_serial_balance for each serial
        const serialBalanceQuery = await db
          .collection("item_serial_balance")
          .where({
            material_id: mat.item_id,
            serial_number: serialItem.system_serial_number,
            batch_id: mat.batch_id,
            location_id: mat.location_id,
            plant_id: data.plant_id,
            organization_id: data.organization_id,
          })
          .get();

        if (
          serialBalanceQuery &&
          serialBalanceQuery.data &&
          serialBalanceQuery.data.length > 0
        ) {
          const currentBalance = serialBalanceQuery.data[0];
          let updatedBalance;

          if (group.operation === "subtract") {
            updatedBalance = {
              ...currentBalance,
              [group.targetQtyField]: Math.max(
                0,
                roundQty(currentBalance[group.targetQtyField] - 1),
              ),
            };
          } else {
            // add
            updatedBalance = {
              ...currentBalance,
              [group.targetQtyField]: roundQty(
                currentBalance[group.targetQtyField] + 1,
              ),
            };
          }

          await db
            .collection("item_serial_balance")
            .doc(currentBalance.id)
            .update(updatedBalance);
        }
      }

      // ✅ CRITICAL FIX: For serialized items, also update item_balance (aggregated across all serial numbers)
      try {
        const generalItemBalanceParams = {
          material_id: mat.item_id,
          location_id: mat.location_id,
          plant_id: data.plant_id,
          organization_id: data.organization_id,
        };
        // Don't include serial_number in item_balance query (aggregated balance across all serials)

        const generalBalanceQuery = await db
          .collection("item_balance")
          .where(generalItemBalanceParams)
          .get();

        const consolidatedQty = group.serials.length; // Each serial = 1 unit

        if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
          // Update existing item_balance
          const generalBalance = generalBalanceQuery.data[0];

          const currentUnrestricted = parseFloat(
            generalBalance.unrestricted_qty || 0,
          );
          const currentReserved = parseFloat(generalBalance.reserved_qty || 0);
          const currentQualityInsp = parseFloat(
            generalBalance.qualityinsp_qty || 0,
          );
          const currentBlocked = parseFloat(generalBalance.block_qty || 0);
          const currentInTransit = parseFloat(
            generalBalance.intransit_qty || 0,
          );

          let newUnrestricted = currentUnrestricted;
          let newReserved = currentReserved;
          let newQualityInsp = currentQualityInsp;
          let newBlocked = currentBlocked;
          let newInTransit = currentInTransit;

          if (group.operation === "subtract") {
            // Deduct from appropriate category (Quality Inspection OUT)
            switch (group.targetQtyField) {
              case "qualityinsp_qty":
                newQualityInsp = Math.max(
                  0,
                  currentQualityInsp - consolidatedQty,
                );
                break;
              case "unrestricted_qty":
                newUnrestricted = Math.max(
                  0,
                  currentUnrestricted - consolidatedQty,
                );
                break;
              case "block_qty":
                newBlocked = Math.max(0, currentBlocked - consolidatedQty);
                break;
              case "intransit_qty":
                newInTransit = Math.max(0, currentInTransit - consolidatedQty);
                break;
              default:
                newQualityInsp = Math.max(
                  0,
                  currentQualityInsp - consolidatedQty,
                );
            }
          } else if (group.operation === "add") {
            // Add to appropriate category (Passed/Failed IN)
            switch (group.targetQtyField) {
              case "unrestricted_qty":
                newUnrestricted = currentUnrestricted + consolidatedQty;
                break;
              case "block_qty":
                newBlocked = currentBlocked + consolidatedQty;
                break;
              case "intransit_qty":
                newInTransit = currentInTransit + consolidatedQty;
                break;
              case "qualityinsp_qty":
                newQualityInsp = currentQualityInsp + consolidatedQty;
                break;
              default:
                newUnrestricted = currentUnrestricted + consolidatedQty;
            }
          }

          const updateData = {
            unrestricted_qty: newUnrestricted,
            reserved_qty: newReserved,
            qualityinsp_qty: newQualityInsp,
            block_qty: newBlocked,
            intransit_qty: newInTransit,
            updated_at: new Date(),
          };

          // Calculate balance_quantity if it exists
          if (generalBalance.hasOwnProperty("balance_quantity")) {
            updateData.balance_quantity =
              newUnrestricted +
              newReserved +
              newQualityInsp +
              newBlocked +
              newInTransit;
          }

          await db
            .collection("item_balance")
            .doc(generalBalance.id)
            .update(updateData);

          console.log(
            `✓ Updated item_balance for serialized item ${mat.item_id} ${
              group.movement
            } movement: ${group.targetQtyField} ${
              group.operation === "subtract" ? "-" : "+"
            }${consolidatedQty}`,
          );
        } else if (group.operation === "add") {
          // Create new item_balance record for IN movement
          const itemBalanceData = {
            material_id: mat.item_id,
            location_id: mat.location_id,
            unrestricted_qty:
              group.targetQtyField === "unrestricted_qty" ? consolidatedQty : 0,
            reserved_qty: 0,
            qualityinsp_qty:
              group.targetQtyField === "qualityinsp_qty" ? consolidatedQty : 0,
            block_qty:
              group.targetQtyField === "block_qty" ? consolidatedQty : 0,
            intransit_qty:
              group.targetQtyField === "intransit_qty" ? consolidatedQty : 0,
            plant_id: data.plant_id,
            organization_id: data.organization_id,
            material_uom: itemData.based_uom,
            created_at: new Date(),
            updated_at: new Date(),
          };

          // Calculate balance_quantity
          itemBalanceData.balance_quantity =
            itemBalanceData.unrestricted_qty +
            itemBalanceData.reserved_qty +
            itemBalanceData.qualityinsp_qty +
            itemBalanceData.block_qty +
            itemBalanceData.intransit_qty;

          await db.collection("item_balance").add(itemBalanceData);
          console.log(
            `✓ Created item_balance for serialized item ${mat.item_id} IN movement: ${group.targetQtyField} +${consolidatedQty}`,
          );
        }
      } catch (itemBalanceError) {
        console.error(
          `Error updating item_balance for serialized item ${mat.item_id}:`,
          itemBalanceError,
        );
        throw itemBalanceError;
      }

      console.log(
        `Created ${group.serials.length} inv_serial_movement records for ${group.category} ${group.movement}`,
      );
    }

    console.log(
      `Successfully processed ${validSerials.length} serial numbers for item ${mat.item_id} with grouped inventory movements`,
    );
  } catch (error) {
    console.error("Error processing serialized item movements:", error);
    throw error;
  }
};

const processInventoryMovement = async (data) => {
  try {
    const matData = data.table_insp_mat;

    const resPutAwaySetup = await db
      .collection("putaway_setup")
      .where({ plant_id: data.plant_id, movement_type: "Good Receiving" })
      .get();
    const putAwaySetupData = resPutAwaySetup?.data[0];
    const putAwayRequired =
      putAwaySetupData && putAwaySetupData.putaway_required === 1 ? 1 : 0;

    for (const mat of matData) {
      if (mat.item_id) {
        const resItem = await db
          .collection("Item")
          .where({ id: mat.item_id, is_deleted: 0 })
          .get();

        if (resItem && resItem.data.length > 0) {
          const itemData = resItem.data[0];

          // Check if this is a serialized item
          if (mat.is_serialized_item === 1 && mat.serial_number_data) {
            console.log(`Processing serialized item ${mat.item_id}`);
            await processSerializedItemMovements(
              data,
              mat,
              itemData,
              putAwayRequired,
            );
          } else {
            // Process non-serialized item as before
            await addInventoryMovementData(
              data,
              "Quality Inspection",
              "OUT",
              itemData,
              mat,
              mat.received_qty,
            );

            if (mat.passed_qty > 0) {
              await addInventoryMovementData(
                data,
                putAwayRequired === 1 ? "In Transit" : "Unrestricted",
                "IN",
                itemData,
                mat,
                mat.passed_qty,
              );
            }

            if (mat.failed_qty > 0) {
              await addInventoryMovementData(
                data,
                putAwayRequired === 1 ? "In Transit" : "Blocked",
                "IN",
                itemData,
                mat,
                mat.failed_qty,
              );
            }
          }

          // Skip balance processing for serialized items as it's handled in processSerializedItemMovements
          if (!(mat.is_serialized_item === 1 && mat.serial_number_data)) {
            await processBalanceTable(itemData, mat, putAwayRequired);
          }
        }
      }
    }

    if (putAwaySetupData && putAwaySetupData.putaway_required === 1) {
      await createPutAway(data, data.organization_id);
    } else if (
      !putAwaySetupData ||
      (putAwaySetupData && putAwaySetupData.putaway_required === 0)
    ) {
      await db
        .collection("goods_receiving")
        .where({
          id: data.goods_receiving_no,
          organization_id: data.organization_id,
        })
        .update({ gr_status: "Completed" });
    }
  } catch {
    throw new Error("Error in creating inventory movement.");
  }
};

const processBalanceTable = async (itemData, matData, putAwayRequired) => {
  try {
    let latestBalanceData = null;

    const convertUOM = (quantity, itemData, matData) => {
      if (matData.received_uom !== itemData.based_uom) {
        for (const uom of itemData.table_uom_conversion) {
          if (matData.received_uom === uom.alt_uom_id) {
            return roundQty(quantity * uom.base_qty);
          }
        }
      } else if (matData.received_uom === itemData.based_uom) {
        return roundQty(quantity);
      }
    };

    if (itemData.item_batch_management) {
      const resBatchBalance = await db
        .collection("item_batch_balance")
        .where({
          material_id: matData.item_id,
          location_id: matData.location_id,
          batch_id: matData.batch_id,
        })
        .get();

      if (resBatchBalance && resBatchBalance.data.length > 0) {
        const batchBalanceData = resBatchBalance.data[0];

        latestBalanceData = {
          material_id: batchBalanceData.material_id,
          location_id: batchBalanceData.location_id,
          block_qty:
            putAwayRequired === 1
              ? batchBalanceData.block_qty
              : batchBalanceData.block_qty +
                convertUOM(matData.failed_qty, itemData, matData),
          reserved_qty: batchBalanceData.reserved_qty,
          unrestricted_qty:
            putAwayRequired === 1
              ? batchBalanceData.unrestricted_qty
              : batchBalanceData.unrestricted_qty +
                convertUOM(matData.passed_qty, itemData, matData),
          qualityinsp_qty:
            batchBalanceData.qualityinsp_qty -
            convertUOM(matData.received_qty, itemData, matData),
          balance_quantity: batchBalanceData.balance_quantity,
          batch_id: batchBalanceData.batch_id,
          plant_id: batchBalanceData.plant_id,
          organization_id: batchBalanceData.organization_id,
          intransit_qty:
            putAwayRequired !== 1
              ? batchBalanceData.intransit_qty
              : batchBalanceData.intransit_qty +
                convertUOM(
                  matData.passed_qty + matData.failed_qty,
                  itemData,
                  matData,
                ),
          material_uom: itemData.based_uom,
        };

        await db
          .collection("item_batch_balance")
          .doc(batchBalanceData.id)
          .update(latestBalanceData);

        // ✅ CRITICAL FIX: For batched items, also update item_balance (aggregated across all batches)
        try {
          const generalItemBalanceParams = {
            material_id: matData.item_id,
            location_id: matData.location_id,
            plant_id: batchBalanceData.plant_id,
            organization_id: batchBalanceData.organization_id,
          };
          // Don't include batch_id in item_balance query (aggregated balance across all batches)

          const generalBalanceQuery = await db
            .collection("item_balance")
            .where(generalItemBalanceParams)
            .get();

          if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
            // Update existing item_balance
            const generalBalance = generalBalanceQuery.data[0];

            const currentUnrestricted = parseFloat(
              generalBalance.unrestricted_qty || 0,
            );
            const currentReserved = parseFloat(
              generalBalance.reserved_qty || 0,
            );
            const currentQualityInsp = parseFloat(
              generalBalance.qualityinsp_qty || 0,
            );
            const currentBlocked = parseFloat(generalBalance.block_qty || 0);
            const currentInTransit = parseFloat(
              generalBalance.intransit_qty || 0,
            );

            // Calculate the deltas from batch balance changes
            const deltaUnrestricted =
              latestBalanceData.unrestricted_qty -
              batchBalanceData.unrestricted_qty;
            const deltaReserved =
              latestBalanceData.reserved_qty - batchBalanceData.reserved_qty;
            const deltaQualityInsp =
              latestBalanceData.qualityinsp_qty -
              batchBalanceData.qualityinsp_qty;
            const deltaBlocked =
              latestBalanceData.block_qty - batchBalanceData.block_qty;
            const deltaInTransit =
              latestBalanceData.intransit_qty - batchBalanceData.intransit_qty;

            const newUnrestricted = Math.max(
              0,
              currentUnrestricted + deltaUnrestricted,
            );
            const newReserved = Math.max(0, currentReserved + deltaReserved);
            const newQualityInsp = Math.max(
              0,
              currentQualityInsp + deltaQualityInsp,
            );
            const newBlocked = Math.max(0, currentBlocked + deltaBlocked);
            const newInTransit = Math.max(0, currentInTransit + deltaInTransit);

            const generalUpdateData = {
              unrestricted_qty: newUnrestricted,
              reserved_qty: newReserved,
              qualityinsp_qty: newQualityInsp,
              block_qty: newBlocked,
              intransit_qty: newInTransit,
              updated_at: new Date(),
            };

            // Calculate balance_quantity if it exists
            if (generalBalance.hasOwnProperty("balance_quantity")) {
              generalUpdateData.balance_quantity =
                newUnrestricted +
                newReserved +
                newQualityInsp +
                newBlocked +
                newInTransit;
            }

            await db
              .collection("item_balance")
              .doc(generalBalance.id)
              .update(generalUpdateData);

            console.log(
              `✓ Updated item_balance for batch item ${matData.item_id} at location ${matData.location_id}`,
            );
          } else {
            // Create new item_balance record if none exists
            const itemBalanceData = {
              material_id: matData.item_id,
              location_id: matData.location_id,
              unrestricted_qty: latestBalanceData.unrestricted_qty,
              reserved_qty: latestBalanceData.reserved_qty,
              qualityinsp_qty: latestBalanceData.qualityinsp_qty,
              block_qty: latestBalanceData.block_qty,
              intransit_qty: latestBalanceData.intransit_qty,
              plant_id: latestBalanceData.plant_id,
              organization_id: latestBalanceData.organization_id,
              material_uom: latestBalanceData.material_uom,
              created_at: new Date(),
              updated_at: new Date(),
            };

            // Calculate balance_quantity
            itemBalanceData.balance_quantity =
              itemBalanceData.unrestricted_qty +
              itemBalanceData.reserved_qty +
              itemBalanceData.qualityinsp_qty +
              itemBalanceData.block_qty +
              itemBalanceData.intransit_qty;

            await db.collection("item_balance").add(itemBalanceData);
            console.log(
              `✓ Created item_balance for batch item ${matData.item_id} at location ${matData.location_id}`,
            );
          }
        } catch (itemBalanceError) {
          console.error(
            `Error updating item_balance for batch item ${matData.item_id}:`,
            itemBalanceError,
          );
          throw itemBalanceError;
        }
      }
    } else {
      const resBalance = await db
        .collection("item_balance")
        .where({
          material_id: matData.item_id,
          location_id: matData.location_id,
        })
        .get();

      if (resBalance && resBalance.data.length > 0) {
        const balanceData = resBalance.data[0];

        latestBalanceData = {
          material_id: balanceData.material_id,
          location_id: balanceData.location_id,
          block_qty:
            putAwayRequired === 1
              ? balanceData.block_qty
              : balanceData.block_qty +
                convertUOM(matData.failed_qty, itemData, matData),
          reserved_qty: balanceData.reserved_qty,
          unrestricted_qty:
            putAwayRequired === 1
              ? balanceData.unrestricted_qty
              : balanceData.unrestricted_qty +
                convertUOM(matData.passed_qty, itemData, matData),
          qualityinsp_qty:
            balanceData.qualityinsp_qty -
            convertUOM(matData.received_qty, itemData, matData),
          balance_quantity: balanceData.balance_quantity,
          plant_id: balanceData.plant_id,
          organization_id: balanceData.organization_id,
          intransit_qty:
            putAwayRequired !== 1
              ? balanceData.intransit_qty
              : balanceData.intransit_qty +
                convertUOM(
                  matData.passed_qty + matData.failed_qty,
                  itemData,
                  matData,
                ),
          material_uom: itemData.based_uom,
        };

        await db
          .collection("item_balance")
          .doc(balanceData.id)
          .update(latestBalanceData);
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

const updateEntry = async (organizationId, entry, inspLotId) => {
  try {
    const prefixData = await getPrefixData(
      organizationId,
      "Receiving Inspection",
    );

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Receiving Inspection",
      );

      await updatePrefix(organizationId, runningNumber, "Receiving Inspection");

      entry.inspection_lot_no = prefixToShow;
    }

    await db.collection("basic_inspection_lot").doc(inspLotId).update(entry);
    await processInventoryMovement(entry);

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    this.$message.error(error);
    console.error(error);
    throw new Error("Error in updating inspection lot.");
  }
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(
      organizationId,
      "Receiving Inspection",
    );

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Receiving Inspection",
      );

      await updatePrefix(organizationId, runningNumber, "Receiving Inspection");

      entry.inspection_lot_no = prefixToShow;
    }

    await db.collection("basic_inspection_lot").add(entry);
    await processInventoryMovement(entry);

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    this.$message.error(error);
    console.error(error);
    throw new Error("Error in creating inspection lot.");
  }
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "goods_receiving_no", label: "Good Receiving No" },
      { name: "inspection_lot_no", label: "Inspection Lot No" },
      { name: "insp_lot_created_on", label: "Insp Lot Created On" },
      {
        name: "table_insp_mat",
        label: "Insp Mat Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    await this.validate("inspection_lot_no");

    for (const [index, item] of data.table_insp_mat.entries()) {
      await this.validate(
        `table_insp_mat.${index}.passed_qty`,
        `table_insp_mat.${index}.failed_qty`,
      );

      // Validate that both passed_qty and failed_qty can't be 0
      if ((item.passed_qty || 0) === 0 && (item.failed_qty || 0) === 0) {
        this.hideLoading();
        this.$message.error(
          `Item ${
            index + 1
          }: Both passed quantity and failed quantity cannot be 0. Please specify inspection results.`,
        );
        return;
      }

      data.inspection_pass_fail = `${item.passed_qty} / ${item.failed_qty}`;
    }

    const missingFields = await validateForm(
      data,
      requiredFields,
      data.table_insp_mat,
    );

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        plant_id,
        goods_receiving_no,
        gr_no_display,
        inspection_lot_no,
        insp_lot_created_on,
        lot_created_by,
        insp_start_time,
        insp_end_time,
        inspector_name,
        inspection_pass_fail,
        organization_id,
        ref_doc,
        table_insp_mat,
        remarks,
      } = data;

      const entry = {
        receiving_insp_status: "Completed",
        plant_id,
        goods_receiving_no,
        gr_no_display,
        inspection_lot_no,
        insp_lot_created_on,
        lot_created_by,
        insp_start_time,
        insp_end_time,
        inspector_name,
        inspection_pass_fail,
        organization_id,
        ref_doc,
        table_insp_mat,
        remarks,
      };

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        const inspLotId = this.getValue("id");
        await updateEntry(organizationId, entry, inspLotId);
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    // Try to get message from standard locations first
    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
