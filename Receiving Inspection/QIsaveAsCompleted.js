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
              `${subField.label} (in ${field.label} #${index + 1})`
            );
          }
        });
      });
    }

    for (const [index, item] of table_insp_mat.entries()) {
      if (item.passed_qty + item.failed_qty !== item.received_qty) {
        missingFields.push(
          `Total quantity of ${index} must be equals to received quantity.`
        );
      } else if (item.passed_qty + item.failed_qty === 0) {
        missingFields.push(
          `Total quantity of ${index} must be equals to received quantity.`
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
    String(now.getMonth() + 1).padStart(2, "0")
  );
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(runNumber).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (
  generatedPrefix,
  organizationId,
  documentTypes
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
      documentTypes
    );
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      `Could not generate a unique ${documentTypes} number after maximum attempts`
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
  quantity
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
      "Transfer Order (Putaway)"
    );
    let putAwayPrefix = "";

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Transfer Order (Putaway)"
      );

      await updatePrefix(
        organizationId,
        runningNumber,
        "Transfer Order (Putaway)"
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

          await addInventoryMovementData(
            data,
            "Quality Inspection",
            "OUT",
            itemData,
            mat,
            mat.received_qty
          );

          if (mat.passed_qty > 0) {
            await addInventoryMovementData(
              data,
              putAwayRequired === 1 ? "In Transit" : "Unrestricted",
              "IN",
              itemData,
              mat,
              mat.passed_qty
            );
          }

          if (mat.failed_qty > 0) {
            await addInventoryMovementData(
              data,
              putAwayRequired === 1 ? "In Transit" : "Blocked",
              "IN",
              itemData,
              mat,
              mat.failed_qty
            );
          }

          await processBalanceTable(itemData, mat, putAwayRequired);
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
                  matData
                ),
          material_uom: itemData.based_uom,
        };

        await db
          .collection("item_batch_balance")
          .doc(batchBalanceData.id)
          .update(latestBalanceData);
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
                  matData
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
      "Receiving Inspection"
    );

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Receiving Inspection"
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
      "Receiving Inspection"
    );

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Receiving Inspection"
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
        `table_insp_mat.${index}.failed_qty`
      );
      data.inspection_pass_fail = `${item.passed_qty} / ${item.failed_qty}`;
    }

    const missingFields = await validateForm(
      data,
      requiredFields,
      data.table_insp_mat
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
