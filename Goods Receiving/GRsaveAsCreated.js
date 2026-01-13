// For quantities - 3 decimal places
const roundQty = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(3));
};

// For prices - 4 decimal places
const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const updatePurchaseOrderStatus = async (purchaseOrderIds, tableGR) => {
  console.log("Starting updatePurchaseOrderStatus", {
    purchaseOrderIds,
    tableGRLength: tableGR.length,
  });

  const poIds = Array.isArray(purchaseOrderIds)
    ? purchaseOrderIds
    : [purchaseOrderIds];
  console.log("Normalized poIds", { poIds });

  let poDataArray = [];

  try {
    const updatePromises = poIds.map(async (purchaseOrderId) => {
      console.log(`Processing purchase order ${purchaseOrderId}`);

      try {
        const filteredGR = tableGR.filter(
          (item) => item.line_po_id === purchaseOrderId
        );
        console.log(`Filtered GR for PO ${purchaseOrderId}`, {
          filteredGRCount: filteredGR.length,
        });

        const resPO = await db
          .collection("purchase_order")
          .where({ id: purchaseOrderId })
          .get();
        console.log(`Fetched PO ${purchaseOrderId}`, { poData: resPO.data });

        if (!resPO.data || !resPO.data.length) {
          console.warn(`Purchase order ${purchaseOrderId} not found`);
          return {
            poId: purchaseOrderId,
            success: false,
            error: "Purchase order not found",
          };
        }

        const poDoc = resPO.data[0];
        const originalPOStatus = poDoc.po_status;
        console.log(`PO ${purchaseOrderId} details`, {
          poDoc,
          originalPOStatus,
        });

        let poItems = poDoc.table_po || [];
        console.log(`PO ${purchaseOrderId} items`, {
          poItemsCount: poItems.length,
        });

        if (!poItems.length) {
          console.warn(`No items found in purchase order ${purchaseOrderId}`);
          return {
            poId: purchaseOrderId,
            success: false,
            error: "No items found in purchase order",
          };
        }

        const filteredPO = poItems
          .map((item, index) => ({ ...item, originalIndex: index }))
          .filter((item) => item.item_id !== "" || item.item_desc !== "")
          .filter((item) =>
            filteredGR.some((gr) => gr.po_line_item_id === item.id)
          );
        console.log(`Filtered PO items for ${purchaseOrderId}`, {
          filteredPOCount: filteredPO.length,
        });

        let totalItems = poItems.length;
        let partiallyReceivedItems = 0;
        let fullyReceivedItems = 0;
        console.log(`Initial counts for PO ${purchaseOrderId}`, {
          totalItems,
          partiallyReceivedItems,
          fullyReceivedItems,
        });

        const updatedPoItems = poItems.map((item) => ({ ...item }));
        console.log(`Created deep copy of PO items for ${purchaseOrderId}`, {
          updatedPoItems,
        });

        filteredPO.forEach((filteredItem, filteredIndex) => {
          const originalIndex = filteredItem.originalIndex;
          const purchaseQty = parseFloat(filteredItem.quantity || 0);
          const grReceivedQty = parseFloat(
            filteredGR[filteredIndex]?.received_qty || 0
          );
          const currentReceivedQty = parseFloat(
            updatedPoItems[originalIndex].received_qty || 0
          );
          const totalReceivedQty = currentReceivedQty + grReceivedQty;

          const outstandingQty = parseFloat(purchaseQty - totalReceivedQty);
          if (outstandingQty < 0) {
            updatedPoItems[originalIndex].outstanding_quantity = 0;
          } else {
            updatedPoItems[originalIndex].outstanding_quantity = outstandingQty;
          }

          console.log(
            `Processing item ${filteredItem.id} for PO ${purchaseOrderId}`,
            {
              purchaseQty,
              grReceivedQty,
              currentReceivedQty,
              totalReceivedQty,
            }
          );

          updatedPoItems[originalIndex].received_qty = totalReceivedQty;
          updatedPoItems[originalIndex].received_ratio =
            purchaseQty > 0 ? totalReceivedQty / purchaseQty : 0;
        });

        for (const po of updatedPoItems) {
          if (po.received_qty > 0) {
            partiallyReceivedItems++;
            po.line_status = "Processing";
            if (po.received_qty >= po.quantity) {
              fullyReceivedItems++;
              po.line_status = "Completed";
            }
          }
        }

        console.log(`Updated counts for PO ${purchaseOrderId}`, {
          partiallyReceivedItems,
          fullyReceivedItems,
        });

        let allItemsComplete = fullyReceivedItems === totalItems;
        let anyItemProcessing = partiallyReceivedItems > 0;
        console.log(`Completion status for PO ${purchaseOrderId}`, {
          allItemsComplete,
          anyItemProcessing,
        });

        let newPOStatus = poDoc.po_status;
        let newGRStatus = poDoc.gr_status;

        if (poDoc.po_status !== "Completed") {
          if (allItemsComplete) {
            newPOStatus = "Completed";
            newGRStatus = "Fully Received";
          } else if (anyItemProcessing) {
            newPOStatus = "Processing";
            newGRStatus = "Partially Received";
          }
        } else {
          newPOStatus = "Completed";
          if (allItemsComplete) {
            newGRStatus = "Fully Received";
          } else if (anyItemProcessing) {
            newGRStatus = "Partially Received";
          }
        }
        console.log(`Status update for PO ${purchaseOrderId}`, {
          originalPOStatus,
          newPOStatus,
          newGRStatus,
        });

        const partiallyReceivedRatio = `${partiallyReceivedItems} / ${totalItems}`;
        const fullyReceivedRatio = `${fullyReceivedItems} / ${totalItems}`;
        console.log(`Ratios for PO ${purchaseOrderId}`, {
          partiallyReceivedRatio,
          fullyReceivedRatio,
        });

        const updateData = {
          table_po: updatedPoItems,
          partially_received: partiallyReceivedRatio,
          fully_received: fullyReceivedRatio,
        };

        if (newPOStatus !== poDoc.po_status) {
          updateData.po_status = newPOStatus;
        }

        if (newGRStatus !== poDoc.gr_status) {
          updateData.gr_status = newGRStatus;
        }
        console.log(`Prepared update data for PO ${purchaseOrderId}`, {
          updateData,
        });

        await db.collection("purchase_order").doc(poDoc.id).update(updateData);
        console.log(`Successfully updated PO ${purchaseOrderId} in database`);

        if (newPOStatus !== originalPOStatus) {
          console.log(
            `Updated PO ${purchaseOrderId} status from ${originalPOStatus} to ${newPOStatus}`
          );
        }

        return {
          poId: purchaseOrderId,
          newPOStatus,
          totalItems,
          partiallyReceivedItems,
          fullyReceivedItems,
          success: true,
        };
      } catch (error) {
        console.error(
          `Error updating purchase order ${purchaseOrderId} status:`,
          error
        );
        return {
          poId: purchaseOrderId,
          success: false,
          error: error.message,
        };
      }
    });

    const results = await Promise.all(updatePromises);
    console.log("All update promises resolved", { results });

    results.forEach((result) => {
      if (result && result.success) {
        poDataArray.push({
          po_id: result.poId,
          status: result.newPOStatus,
        });
      }
    });
    console.log("Processed results", { poDataArray });

    const successCount = results.filter((r) => r && r.success).length;
    const failCount = results.filter((r) => r && !r.success).length;

    console.log(`PO Status Update Summary: 
      Total POs: ${poIds.length}
      Successfully updated: ${successCount}
      Failed updates: ${failCount}
    `);

    return {
      po_data_array: poDataArray,
    };
  } catch (error) {
    console.error(`Error in update purchase order status process:`, error);
    return {
      po_data_array: [],
    };
  }
};

const validateForm = (data, requiredFields) => {
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
  if (documentTypes === "Goods Receiving") {
    const existingDoc = await db
      .collection("goods_receiving")
      .where({ gr_no: generatedPrefix, organization_id: organizationId })
      .get();

    return existingDoc.data[0] ? false : true;
  } else if (documentTypes === "Transfer Order (Putaway)") {
    const existingDoc = await db
      .collection("transfer_order_putaway")
      .where({ to_id: generatedPrefix, organization_id: organizationId })
      .get();

    return existingDoc.data[0] ? false : true;
  } else if (documentTypes === "Receiving Inspection") {
    const existingDoc = await db
      .collection("basic_inspection_lot")
      .where({
        inspection_lot_no: generatedPrefix,
        organization_id: organizationId,
      })
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

const processRow = async (item, organizationId) => {
  if (item.item_batch_no === "Auto-generated batch number") {
    const resBatchConfig = await db
      .collection("batch_level_config")
      .where({ organization_id: organizationId })
      .get();

    if (resBatchConfig && resBatchConfig.data.length > 0) {
      const batchConfigData = resBatchConfig.data[0];
      let batchDate = "";
      let dd,
        mm,
        yy = "";

      // Checking for related field
      switch (batchConfigData.batch_format) {
        case "Document Date":
          let issueDate = this.getValue("gr_date");

          if (!issueDate)
            throw new Error(
              "Received Date is required for generating batch number."
            );

          console.log("issueDate", new Date(issueDate));

          issueDate = new Date(issueDate);

          dd = String(issueDate.getDate()).padStart(2, "0");
          mm = String(issueDate.getMonth() + 1).padStart(2, "0");
          yy = String(issueDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Document Created Date":
          let createdDate = new Date().toISOString().split("T")[0];

          console.log("createdDate", createdDate);

          createdDate = new Date(createdDate);

          dd = String(createdDate.getDate()).padStart(2, "0");
          mm = String(createdDate.getMonth() + 1).padStart(2, "0");
          yy = String(createdDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Manufacturing Date":
          let manufacturingDate = item.manufacturing_date;

          console.log("manufacturingDate", manufacturingDate);

          if (!manufacturingDate)
            throw new Error(
              "Manufacturing Date is required for generating batch number."
            );

          manufacturingDate = new Date(manufacturingDate);

          dd = String(manufacturingDate.getDate()).padStart(2, "0");
          mm = String(manufacturingDate.getMonth() + 1).padStart(2, "0");
          yy = String(manufacturingDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Expired Date":
          let expiredDate = item.expired_date;

          console.log("expiredDate", expiredDate);

          if (!expiredDate)
            throw new Error(
              "Expired Date is required for generating batch number."
            );

          expiredDate = new Date(expiredDate);

          dd = String(expiredDate.getDate()).padStart(2, "0");
          mm = String(expiredDate.getMonth() + 1).padStart(2, "0");
          yy = String(expiredDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;
      }

      let batchPrefix = batchConfigData.batch_prefix || "";
      if (batchPrefix) batchPrefix += "-";

      const generatedBatchNo =
        batchPrefix +
        batchDate +
        String(batchConfigData.batch_running_number).padStart(
          batchConfigData.batch_padding_zeroes,
          "0"
        );

      item.item_batch_no = generatedBatchNo;
      await db
        .collection("batch_level_config")
        .where({ id: batchConfigData.id })
        .update({
          batch_running_number: batchConfigData.batch_running_number + 1,
        });

      return item;
    }
  } else {
    return item;
  }
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

    return obj.toString();
  }
  return null;
};

const updateEntry = async (
  organizationId,
  entry,
  goodsReceivingId,
  putAwaySetupData
) => {
  try {
    const prefixData = await getPrefixData(organizationId, "Goods Receiving");

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "Goods Receiving"
      );

      await updatePrefix(organizationId, runningNumber, "Goods Receiving");

      entry.gr_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(entry.gr_no, organizationId);
      if (!isUnique) {
        throw new Error(
          `GR Number "${entry.gr_no}" already exists. Please use a different number.`
        );
      }
    }

    const processedTableGr = [];
    for (const item of entry.table_gr) {
      const processedItem = await processRow(item, organizationId);
      processedTableGr.push(processedItem);
    }
    entry.table_gr = processedTableGr;

    await db.collection("goods_receiving").doc(goodsReceivingId).update(entry);

    const purchaseOrderIds = entry.po_id;

    const { po_data_array } = await updatePurchaseOrderStatus(
      purchaseOrderIds,
      entry.table_gr
    );
    const allNoItemCode = entry.table_gr.every((gr) => !gr.item_id);
    if (
      !putAwaySetupData ||
      (putAwaySetupData && putAwaySetupData.putaway_required === 0) ||
      allNoItemCode
    ) {
      await this.runWorkflow(
        "1917412667253141505",
        { gr_no: entry.gr_no, po_data: po_data_array },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          this.$message.error("Workflow execution failed");
          console.error("失败结果：", err);
          closeDialog();
        }
      );
    }
    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

const fetchReceivedQuantity = async () => {
  const tableGR = this.getValue("table_gr") || [];

  const resPOLineData = await Promise.all(
    tableGR.map((item) =>
      db
        .collection("purchase_order_2ukyuanr_sub")
        .doc(item.po_line_item_id)
        .get()
    )
  );

  const poLineItemData = resPOLineData.map((response) => response.data[0]);

  const resItem = await Promise.all(
    tableGR
      .filter((item) => item.item_id !== null && item.item_id !== undefined)
      .map((item) => db.collection("Item").doc(item.item_id).get())
  );

  const itemData = resItem.map((response) => response.data[0]);

  const invalidReceivedQty = [];

  for (const [index, item] of tableGR.entries()) {
    const poLine = poLineItemData.find((po) => po.id === item.po_line_item_id);
    const itemInfo = itemData.find((data) => data.id === item.item_id);
    if (poLine) {
      const tolerance = itemInfo ? itemInfo.over_receive_tolerance || 0 : 0;
      const maxReceivableQty =
        ((poLine.quantity || 0) - (poLine.received_qty || 0)) *
        ((100 + tolerance) / 100);
      if ((item.received_qty || 0) > maxReceivableQty) {
        invalidReceivedQty.push(`#${index + 1}`);
        this.setData({
          [`table_gr.${index}.to_received_qty`]:
            (poLine.quantity || 0) - (poLine.received_qty || 0),
        });
      }
    }
  }

  if (invalidReceivedQty.length > 0) {
    await this.$alert(
      `Line${
        invalidReceivedQty.length > 1 ? "s" : ""
      } ${invalidReceivedQty.join(", ")} ha${
        invalidReceivedQty.length > 1 ? "ve" : "s"
      } an expected received quantity exceeding the maximum receivable quantity.`,
      "Invalid Received Quantity",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );

    throw new Error("Invalid received quantity detected.");
  }
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, grLineItem] of entry.table_gr.entries()) {
      grLineItem.supplier_id = entry.supplier_name || null;
      grLineItem.organization_id = entry.organization_id;
      grLineItem.plant_id = entry.plant_id || null;
      grLineItem.billing_state_id = entry.billing_address_state || null;
      grLineItem.billing_country_id = entry.billing_address_country || null;
      grLineItem.shipping_state_id = entry.shipping_address_state || null;
      grLineItem.shipping_country_id = entry.shipping_address_country || null;
      grLineItem.assigned_to = entry.assigned_to || null;
      grLineItem.line_index = index + 1;
    }
    return entry.table_gr;
  } catch {
    throw new Error("Error processing goods receiving.");
  }
};

// Validate serial number allocation for serialized items
const validateSerialNumberAllocation = async (tableGR) => {
  const serializedItemsNotAllocated = [];

  for (const [index, item] of tableGR.entries()) {
    // Check if item is serialized but not allocated
    if (item.is_serialized_item === 1 && item.is_serial_allocated !== 1) {
      // Get item details for better error message
      let itemIdentifier =
        item.item_name ||
        item.item_code ||
        item.item_id ||
        `Item at row ${index + 1}`;
      serializedItemsNotAllocated.push({
        index: index + 1,
        identifier: itemIdentifier,
        item_id: item.item_id,
      });
    }
  }

  if (serializedItemsNotAllocated.length > 0) {
    const itemsList = serializedItemsNotAllocated
      .map((item) => `• Row ${item.index}: ${item.identifier}`)
      .join("\n");

    throw new Error(
      `Serial number allocation is required for the following serialized items:\n\n${itemsList}\n\nPlease allocate serial numbers for all serialized items before saving.`
    );
  }

  console.log(
    "Serial number allocation validation passed for all serialized items"
  );
  return true;
};

const processGRLineItem = async (entry) => {
  const totalQuantity = entry.table_gr.reduce((sum, item) => {
    const { received_qty } = item;
    return sum + (received_qty || 0); // Handle null/undefined received_qty
  }, 0);

  if (totalQuantity === 0) {
    throw new Error("Total return quantity is 0.");
  }

  const zeroQtyArray = [];
  for (const [index, gr] of entry.table_gr.entries()) {
    if (gr.received_qty <= 0) {
      zeroQtyArray.push(`#${index + 1}`);
    }
  }

  if (zeroQtyArray.length > 0) {
    await this.$confirm(
      `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
        zeroQtyArray.length > 1 ? "ve" : "s"
      } a zero receive quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 receive quantity. \nWould you like to proceed?`,
      "Zero Receive Quantity Detected",
      {
        confirmButtonText: "OK",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: false,
      }
    )
      .then(async () => {
        console.log("User clicked OK");
        entry.table_gr = entry.table_gr.filter((item) => item.received_qty > 0);

        let poID = [];
        let purchaseOrderNumber = [];

        for (const gr of entry.table_gr) {
          poID.push(gr.line_po_id);
          purchaseOrderNumber.push(gr.line_po_no);
        }

        poID = [...new Set(poID)];
        purchaseOrderNumber = [...new Set(purchaseOrderNumber)];

        entry.po_id = poID;
        entry.po_no_display = purchaseOrderNumber.join(", ");

        return entry;
      })
      .catch(() => {
        // Function to execute when the user clicks "Cancel" or closes the dialog
        console.log("User clicked Cancel or closed the dialog");
        this.hideLoading();
        throw new Error("Saving goods receiving cancelled.");
        // Add your logic to stop or handle cancellation here
        // Example: this.stopFunction();
      });
  }

  return entry;
};

const saveGoodsReceiving = async (entry, putAwaySetupData) => {
  try {
    const status = this.getValue("gr_status");
    const pageStatus = this.getValue("page_status");
    const organizationId = entry.organization_id;
    let grID = "";

    const processedTableGr = [];
    for (const item of entry.table_gr) {
      const processedItem = await processRow(item, entry.organization_id);
      processedTableGr.push(processedItem);
    }
    entry.table_gr = processedTableGr;

    // add status
    if (pageStatus === "Add") {
      const prefixData = await getPrefixData(organizationId, "Goods Receiving");

      if (prefixData !== null) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
          "Goods Receiving"
        );

        await updatePrefix(organizationId, runningNumber, "Goods Receiving");

        entry.gr_no = prefixToShow;
      } else {
        const isUnique = await checkUniqueness(entry.gr_no, organizationId);
        if (!isUnique) {
          throw new Error(
            `GR Number "${entry.gr_no}" already exists. Please use a different number.`
          );
        }
      }
      const grResponse = await db.collection("goods_receiving").add(entry);
      grID = grResponse.data[0].id;
    }
    // edit status
    if (pageStatus === "Edit") {
      grID = entry.id;
      // draft status
      if (!status || status === "Draft") {
        const prefixData = await getPrefixData(
          organizationId,
          "Goods Receiving"
        );

        if (prefixData !== null) {
          const { prefixToShow, runningNumber } = await findUniquePrefix(
            prefixData,
            organizationId,
            "Goods Receiving"
          );

          await updatePrefix(organizationId, runningNumber, "Goods Receiving");

          entry.gr_no = prefixToShow;
        } else {
          const isUnique = await checkUniqueness(entry.gr_no, organizationId);
          if (!isUnique) {
            throw new Error(
              `GR Number "${entry.gr_no}" already exists. Please use a different number.`
            );
          }
        }
      }
      await db.collection("goods_receiving").doc(grID).update(entry);
    }

    const purchaseOrderIds = entry.po_id;

    await updatePurchaseOrderStatus(purchaseOrderIds, entry.table_gr);
    this.hideLoading();
    closeDialog();
  } catch (error) {
    console.error(error.toString());
    throw error;
  }
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading("Saving Goods Receiving...");

    const requiredFields = [
      { name: "gr_no", label: "Good Receiving Number" },
      { name: "gr_date", label: "Received Date" },
      { name: "plant_id", label: "Plant" },
      {
        name: "table_gr",
        label: "GR Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [
          { name: "location_id", label: "Target Location" },
          { name: "item_batch_no", label: "Batch Number" },
          { name: "inv_category", label: "Inventory Category" },
        ],
      },
    ];

    for (const [index] of data.table_gr.entries()) {
      await this.validate(
        `table_gr.${index}.received_qty`,
        `table_gr.${index}.item_batch_no`
      );
    }

    const resPutAwaySetup = await db
      .collection("putaway_setup")
      .where({ plant_id: data.plant_id, movement_type: "Good Receiving" })
      .get();
    const putAwaySetupData = resPutAwaySetup?.data[0];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      if (putAwaySetupData && putAwaySetupData.putaway_required === 1) {
        if (!data.assigned_to) {
          await this.$confirm(
            `Assigned To field is empty.\nIf you proceed, assigned person in putaway record will be empty. \nWould you like to proceed?`,
            "No Assigned Person Detected",
            {
              confirmButtonText: "OK",
              cancelButtonText: "Cancel",
              type: "warning",
              dangerouslyUseHTMLString: false,
            }
          ).catch(() => {
            console.log("User clicked Cancel or closed the dialog");
            this.hideLoading();
            throw new Error("Saving goods receiving cancelled.");
          });
        }
      }

      let entry = data;
      entry.gr_status = "Created";

      const latestGR = await processGRLineItem(entry);

      if (latestGR.table_gr.length === 0) {
        throw new Error(
          "All Received Quantity must not be 0. Please add at lease one item with received quantity > 0."
        );
      }

      console.log(
        "Validating serial number allocation for serialized items..."
      );
      await validateSerialNumberAllocation(latestGR.table_gr);

      await fetchReceivedQuantity();
      await fillbackHeaderFields(latestGR);

      if (page_status === "Add") {
        await saveGoodsReceiving(latestGR, putAwaySetupData);
        this.$message.success("Add successfully");
      } else if (page_status === "Edit") {
        await saveGoodsReceiving(latestGR, putAwaySetupData);
        this.$message.success("Update successfully");
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
      errorMessage = findFieldMessage(error) || error.toString();
    } else {
      errorMessage = error.toString() || error.message;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
