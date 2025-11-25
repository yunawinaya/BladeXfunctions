const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const addOnPO = async (data) => {
  // Log function entry with input data
  console.log(
    `[${new Date().toISOString()}] addOnPO started with data:`,
    JSON.stringify(data, null, 2)
  );
  const currentPOStatus = this.getValue("po_status");
  console.log(
    `[${new Date().toISOString()}] Current PO Status: ${currentPOStatus}`
  );

  const items = data.table_po;

  // Validate items array
  if (!Array.isArray(items)) {
    console.error(
      `[${new Date().toISOString()}] table_po is not an array:`,
      items
    );
    return;
  }
  console.log(`[${new Date().toISOString()}] Processing ${items.length} items`);

  // Process items sequentially to ensure proper line number sequencing
  for (const [index, item] of items.entries()) {
    try {
      // Log item details
      console.log(
        `[${new Date().toISOString()}] Processing item ${index + 1}:`,
        {
          item_id: item.item_id,
          quantity: item.quantity,
          quantity_uom: item.quantity_uom,
        }
      );

      // Query Item collection
      console.log(
        `[${new Date().toISOString()}] Querying Item collection for item_id: ${
          item.item_id
        }`
      );
      const itemRes = await db
        .collection("Item")
        .where({ id: item.item_id })
        .get();

      // Check query result
      if (!itemRes.data || !itemRes.data.length) {
        console.error(
          `[${new Date().toISOString()}] Item not found for item_id: ${
            item.item_id
          }`
        );
        continue;
      }
      console.log(`[${new Date().toISOString()}] Item found:`, itemRes.data[0]);

      const itemData = itemRes.data[0];

      // Initialize quantities and UOMs
      let altQty = parseFloat(item.quantity);
      let baseQty = altQty;
      let altUOM = item.quantity_uom;
      let baseUOM = itemData.based_uom;
      console.log(
        `[${new Date().toISOString()}] Initial quantities - altQty: ${altQty} ${altUOM}, baseQty: ${baseQty} ${baseUOM}`
      );

      // Handle UOM conversion
      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        console.log(
          `[${new Date().toISOString()}] Checking UOM conversions for item ${
            item.item_id
          }`
        );

        const uomConversion = itemData.table_uom_conversion.find(
          (conv) => conv.alt_uom_id === altUOM
        );

        if (uomConversion) {
          console.log(
            `[${new Date().toISOString()}] Found UOM conversion: 1 ${
              uomConversion.alt_uom_id
            } = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
          );

          baseQty = Math.round(altQty * uomConversion.base_qty * 1000) / 1000;
          console.log(
            `[${new Date().toISOString()}] Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`
          );
        } else {
          console.warn(
            `[${new Date().toISOString()}] No conversion found for UOM ${altUOM}, using as-is`
          );
        }
      } else {
        console.warn(
          `[${new Date().toISOString()}] No UOM conversion table for item ${
            item.item_id
          }, using ordered quantity as-is`
        );
      }

      // Prepare onOrderData with sequential line number
      const onOrderData = {
        purchase_order_number: data.purchase_order_no,
        material_id: item.item_id,
        purchase_order_line: index + 1,
        scheduled_qty: baseQty,
        open_qty: baseQty,
        received_qty: 0,
        plant_id: data.po_plant,
        organization_id: data.organization_id,
      };
      console.log(
        `[${new Date().toISOString()}] Prepared onOrderData for item ${
          index + 1
        }:`,
        onOrderData
      );

      // Handle PO status
      if (currentPOStatus && currentPOStatus === "Issued") {
        console.log(
          `[${new Date().toISOString()}] Updating on_order_purchase_order for item ${
            index + 1
          } (PO Status: Issued)`
        );
        await db
          .collection("on_order_purchase_order")
          .where({
            plant_id: onOrderData.plant_id,
            organization_id: onOrderData.organization_id,
            purchase_order_number: onOrderData.purchase_order_number,
            material_id: onOrderData.material_id,
            purchase_order_line: onOrderData.purchase_order_line,
          })
          .update(onOrderData)
          .catch((error) => {
            console.error(
              `[${new Date().toISOString()}] Error updating on_order_purchase_order for item ${
                index + 1
              }:`,
              error
            );
            throw error; // Rethrow to be caught by outer try-catch
          });
        console.log(
          `[${new Date().toISOString()}] Successfully updated on_order_purchase_order for item ${
            index + 1
          }`
        );
      } else if (!currentPOStatus || currentPOStatus === "Draft") {
        console.log(
          `[${new Date().toISOString()}] Adding to on_order_purchase_order for item ${
            index + 1
          } (PO Status: ${currentPOStatus || "None"})`
        );
        await db
          .collection("on_order_purchase_order")
          .add(onOrderData)
          .catch((error) => {
            console.error(
              `[${new Date().toISOString()}] Error adding to on_order_purchase_order for item ${
                index + 1
              }:`,
              error
            );
            throw error; // Rethrow to be caught by outer try-catch
          });
        console.log(
          `[${new Date().toISOString()}] Successfully added to on_order_purchase_order for item ${
            index + 1
          }`
        );
      } else {
        console.warn(
          `[${new Date().toISOString()}] Unexpected PO status: ${currentPOStatus}, skipping update/add for item ${
            index + 1
          }`
        );
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error processing item ${
          item.item_id
        } (index ${index + 1}):`,
        error
      );
      // Continue with next item instead of throwing
      continue;
    }
  }

  console.log(`[${new Date().toISOString()}] All items processed successfully`);
};

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value, field)) {
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
    if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue, subField)) {
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

const validateField = (value, _field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const checkExistingGoodsReceiving = async () => {
  const poID = this.getValue("id");

  const resGR = await db
    .collection("goods_receiving")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "po_id",
            operator: "in",
            value: poID,
          },
          {
            prop: "gr_status",
            operator: "equal",
            value: "Draft",
          },
        ],
      },
    ])
    .get();

  if (!resGR || resGR.data.length === 0) return [];

  console.log("checkExistingGR", resGR.data);
  return resGR.data;
};

const checkExistingPurchaseInvoice = async () => {
  const poID = this.getValue("id");

  const resPI = await db
    .collection("purchase_invoice")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "po_id",
            operator: "in",
            value: poID,
          },
          {
            prop: "pi_status",
            operator: "equal",
            value: "Draft",
          },
        ],
      },
    ])
    .get();

  if (!resPI || resPI.data.length === 0) return [];

  return resPI.data;
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

const updateItemTransactionDate = async (entry) => {
  try {
    const tablePO = entry.table_po;

    const uniqueItemIds = [
      ...new Set(
        tablePO.filter((item) => item.item_id).map((item) => item.item_id)
      ),
    ];

    const date = new Date().toISOString();
    for (const [index, item] of uniqueItemIds.entries()) {
      try {
        await db
          .collection("Item")
          .doc(item)
          .update({ last_transaction_date: date });
      } catch {
        throw new Error(
          `Cannot update last transaction date for item #${index + 1}.`
        );
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, poLineItem] of entry.table_po.entries()) {
      poLineItem.supplier_id = entry.po_supplier_id || null;
      poLineItem.plant_id = entry.po_plant || null;
      poLineItem.payment_term_id = entry.po_payment_terms || null;
      poLineItem.shipping_preference_id = entry.po_shipping_preference || null;
      poLineItem.billing_state_id = entry.billing_address_state || null;
      poLineItem.billing_country_id = entry.billing_address_country || null;
      poLineItem.shipping_state_id = entry.shipping_address_state || null;
      poLineItem.shipping_country_id = entry.shipping_address_country || null;
      poLineItem.preq_id = entry.preq_id || null;
      poLineItem.line_index = index + 1;
      poLineItem.organization_id = entry.organization_id;
      poLineItem.line_status = entry.po_status;
      poLineItem.po_created_by = this.getVarGlobal("nickname");
    }
    return entry.table_po;
  } catch {
    throw new Error("Error processing purchase order.");
  }
};

const validateQuantity = async (tablePO) => {
  const quantityFailValFields = [];
  const itemFailValFields = [];

  tablePO.forEach((item, index) => {
    if (item.item_id || item.item_desc) {
      if (item.quantity <= 0) {
        quantityFailValFields.push(`${item.item_name}`);
      }
    } else {
      if (item.quantity > 0) {
        itemFailValFields.push(index + 1);
      }
    }
  });

  return { quantityFailValFields, itemFailValFields };
};

const deleteRelatedGR = async (existingGR) => {
  try {
    for (const gr of existingGR) {
      await db.collection("goods_receiving").doc(gr.id).update({
        is_deleted: 1,
      });
    }
  } catch {
    throw new Error("Error in deleting associated goods receiving.");
  }
};

const deleteRelatedPI = async (existingPI) => {
  try {
    for (const pi of existingPI) {
      await db.collection("purchase_invoice").doc(pi.id).update({
        is_deleted: 1,
      });
    }
  } catch {
    throw new Error("Error in deleting associated purchase invoice.");
  }
};

const generatePrefix = async (entry) => {
  try {
    let currentPrefix = entry.purchase_order_no;
    let organizationID = entry.organization_id;
    let docNoID = entry.document_no_format;
    const status = "Issued";
    let documentTypes = "Purchase Orders";

    if (currentPrefix === "<<new>>" || this.getValue("po_status") === "Draft") {
      const workflowResult = await new Promise((resolve, reject) => {
        this.runWorkflow(
          "1984071042628268034",
          {
            document_type: documentTypes,
            organization_id: organizationID,
            document_no_id: docNoID,
            status: status,
            doc_no: currentPrefix,
            prev_status: "",
          },
          (res) => resolve(res),
          (err) => reject(err)
        );
      });

      console.log("res", workflowResult);
      const result = workflowResult.data;

      if (result.is_unique === "TRUE") {
        currentPrefix = result.doc_no;
        console.log("result", result.doc_no);
      } else {
        currentPrefix = result.doc_no;
        throw new Error(
          `${documentTypes} Number "${currentPrefix}" already exists. Please reset the running number.`
        ); // Specific error
      }
    } else {
      const id = entry.id || "";
      const checkUniqueness = await db
        .collection("purchase_order")
        .where({
          purchase_order_no: currentPrefix,
          organization_id: organizationID,
        })
        .get();

      if (checkUniqueness.data.length > 0) {
        if (checkUniqueness.data[0].id !== id) {
          throw new Error(
            `${documentTypes} Number "${currentPrefix}" already exists. Please use a different number.`
          );
        }
      }
    }

    return currentPrefix;
  } catch (error) {
    await this.$alert(error.toString(), "Error", {
      confirmButtonText: "OK",
      type: "error",
    });
    this.hideLoading();
    throw error;
  }
};

const savePurchaseOrders = async (entry) => {
  try {
    const status = this.getValue("po_status");
    const pageStatus = this.getValue("page_status");

    // add status
    if (pageStatus === "Add" || pageStatus === "Clone") {
      entry.purchase_order_no = await generatePrefix(entry);
      await db.collection("purchase_order").add(entry);
    }
    // edit status
    if (pageStatus === "Edit") {
      // draft status
      if (!status || status === "Draft") {
        entry.purchase_order_no = await generatePrefix(entry);
      }
      await db.collection("purchase_order").doc(entry.id).update(entry);
    }

    await addOnPO(entry);
  } catch (error) {
    console.error(error.toString());
  }
};

(async () => {
  try {
    this.showLoading("Saving Purchase Orders...");
    const data = this.getValues();
    const requiredFields = [
      { name: "po_supplier_id", label: "Supplier Name" },
      { name: "po_plant", label: "Plant" },
      { name: "purchase_order_no", label: "PO Number" },
      {
        name: "table_po",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);
    const { quantityFailValFields, itemFailValFields } = await validateQuantity(
      data.table_po
    );

    if (missingFields.length > 0) {
      this.hideLoading();
      throw new Error(`Validation errors: ${missingFields.join(", ")}`);
    } else {
      if (quantityFailValFields.length > 0 || itemFailValFields.length > 0) {
        this.hideLoading();
        await this.$confirm(
          `${
            quantityFailValFields.length > 0
              ? "The following items have quantity less than or equal to zero: " +
                quantityFailValFields.join(", ") +
                "<br><br>"
              : ""
          }
          ${
            itemFailValFields.length > 0
              ? "The following items have quantity but missing item code: Line " +
                itemFailValFields.join(", Line ") +
                "<br><br>"
              : ""
          }
          <strong>If you proceed, these items will be removed from your order. Do you want to continue?</strong>`,
          "Line Item Validation Failed",
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "error",
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving purchase order cancelled.");
        });
      }

      this.showLoading();
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      let entry = data;
      entry.po_status = "Issued";

      if (
        (!entry.partially_received || entry.partially_received === "") &&
        (!entry.fully_received || entry.fully_received === "")
      ) {
        const lineItemLength = entry.table_po.length;

        entry.partially_received = `0 / ${lineItemLength}`;
        entry.fully_received = `0 / ${lineItemLength}`;
      }

      const latestPO = entry.table_po.filter(
        (item) => (item.item_id || item.item_desc) && item.quantity > 0
      );
      entry.table_po = latestPO;

      if (entry.table_po.length === 0) {
        throw new Error(
          "Item Information must not be empty. Please add at least one valid item with quantity > 0"
        );
      }

      entry.table_po = await fillbackHeaderFields(entry);
      for (const [index, lineItem] of entry.table_po.entries()) {
        await this.validate(`table_po.${index}.unit_price`);
      }

      if (page_status === "Add" || page_status === "Clone") {
        await savePurchaseOrders(entry);
      } else if (page_status === "Edit") {
        const currentPOStatus = this.getValue("po_status");

        if (currentPOStatus === "Issued") {
          const existingGR = await checkExistingGoodsReceiving();
          const existingPI = await checkExistingPurchaseInvoice();

          if (existingGR.length > 0 || existingPI.length > 0) {
            this.hideLoading();
            await this.$confirm(
              `${
                existingGR.length > 0
                  ? "The purchase order has existing goods receiving records in draft status. Proceeding will delete all associated goods receiving records.<br><br>"
                  : ""
              }
                ${
                  existingPI.length > 0
                    ? "The purchase order has existing purchase invoice records in draft status. Proceeding will delete all associated purchase invoice records.<br><br>"
                    : ""
                }
                <strong>Do you wish to continue?</strong>`,
              `Existing ${
                existingGR.length && existingPI.length > 0
                  ? "GR and PI"
                  : existingGR.length > 0
                  ? "GR"
                  : existingPI.length > 0
                  ? "PI"
                  : ""
              } detected`,
              {
                confirmButtonText: "Proceed",
                cancelButtonText: "Cancel",
                type: "error",
                dangerouslyUseHTMLString: true,
              }
            ).catch(() => {
              console.log("User clicked Cancel or closed the dialog");
              this.hideLoading();
              throw new Error("Saving purchase order cancelled.");
            });

            this.showLoading();
            await deleteRelatedGR(existingGR);
            await deleteRelatedPI(existingPI);
          }
        }
        await savePurchaseOrders(entry);
      }

      await updateItemTransactionDate(entry);
      if (entry.preq_id && entry.preq_id !== "") {
        const preqID = entry.preq_id;
        console.log("preqID", preqID);
        await Promise.all(
          preqID.map((id) =>
            db.collection("purchase_requisition").doc(id).update({
              preq_status: "Completed",
            })
          )
        );
      }
      await closeDialog();
    }
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error.toString();
    }

    this.$message.error(errorMessage);
    console.error(error);
  }
})();
