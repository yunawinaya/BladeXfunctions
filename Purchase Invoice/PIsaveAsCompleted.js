const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
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
              `${subField.label} (in ${field.label} #${index + 1})`,
            );
          }
        });
      });
    }
  });

  return missingFields;
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

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const processPILineItem = async (entry) => {
  const totalQuantity = entry.table_pi.reduce((sum, item) => {
    const { invoice_qty } = item;
    return sum + (invoice_qty || 0); // Handle null/undefined received_qty
  }, 0);

  if (totalQuantity === 0) {
    throw new Error("Total invoiced quantity is 0.");
  }

  const zeroQtyArray = [];
  for (const [index, pi] of entry.table_pi.entries()) {
    if (pi.invoice_qty <= 0) {
      zeroQtyArray.push(`#${index + 1}`);
    }
  }

  if (zeroQtyArray.length > 0) {
    await this.$confirm(
      `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
        zeroQtyArray.length > 1 ? "ve" : "s"
      } a zero invoice quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 invoice quantity. \nWould you like to proceed?`,
      "Zero Invoice Quantity Detected",
      {
        confirmButtonText: "OK",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: false,
      },
    )
      .then(async () => {
        console.log("User clicked OK");
        entry.table_pi = entry.table_pi.filter((item) => item.invoice_qty > 0);

        let poID = [];
        let grID = [];
        let purchaseOrderNumber = [];
        let goodsReceivingNumber = [];

        for (const pi of entry.table_pi) {
          if (pi.line_gr_id && pi.line_gr_id !== "") {
            grID.push(pi.line_gr_id);
            goodsReceivingNumber.push(pi.goods_receiving_no);
          }

          poID.push(pi.line_po_id);
          purchaseOrderNumber.push(pi.purchase_order_no);
        }

        poID = [...new Set(poID)];
        grID = [...new Set(grID)];
        purchaseOrderNumber = [...new Set(purchaseOrderNumber)];
        goodsReceivingNumber = [...new Set(goodsReceivingNumber)];

        entry.po_id = poID;
        entry.gr_id = grID;
        entry.po_no_display = purchaseOrderNumber.join(", ");
        entry.gr_no_display = goodsReceivingNumber.join(", ");

        return entry;
      })
      .catch(() => {
        // Function to execute when the user clicks "Cancel" or closes the dialog
        console.log("User clicked Cancel or closed the dialog");
        this.hideLoading();
        throw new Error("Saving purchase invoice cancelled.");
        // Add your logic to stop or handle cancellation here
        // Example: this.stopFunction();
      });
  }

  return entry;
};

const updateReferenceDocStatus = async (data) => {
  // Validate input data
  if (!data || !data.po_id || !data.table_pi) {
    throw new Error("Invalid input data: po_id and table_pi are required");
  }

  const poIds = Array.isArray(data.po_id) ? data.po_id : [data.po_id];

  // Process Goods Receiving (GR) documents if doc_type is "Goods Receiving"
  if (data.gr_id.length > 0) {
    const grIds = Array.isArray(data.gr_id) ? data.gr_id : [data.gr_id];
    await updateGoodsReceiving(grIds, data.table_pi);
  }

  // Process Purchase Order (PO) documents
  await updatePurchaseOrders(poIds, data.table_pi);
};

const updateGoodsReceiving = async (grIds, tablePi) => {
  const updateGRPromises = grIds.map(async (goodsReceivingId) => {
    try {
      // Fetch GR document
      const resGR = await db
        .collection("goods_receiving")
        .where({ id: goodsReceivingId })
        .field("table_gr,pi_status")
        .get();

      if (!resGR || !resGR.data || resGR.data.length === 0) {
        console.warn(
          `No Goods Receiving document found for ID: ${goodsReceivingId}`,
        );
        return;
      }

      const grDoc = resGR.data[0];
      const grItems = grDoc.table_gr || [];

      // Process GR items
      const { updatedItems, newPIStatus } = processItems(
        grItems,
        tablePi,
        grDoc.id,
        "line_gr_id",
        "gr_line_id",
        "received_qty",
      );

      // Update GR document
      await db.collection("goods_receiving").doc(grDoc.id).update({
        table_gr: updatedItems,
        pi_status: newPIStatus,
      });
    } catch (error) {
      console.error(
        `Error updating Goods Receiving ID ${goodsReceivingId}:`,
        error,
      );
      throw error;
    }
  });

  await Promise.all(updateGRPromises);
};

const updatePurchaseOrders = async (poIds, tablePi) => {
  const updatePOPromises = poIds.map(async (purchaseOrderId) => {
    try {
      // Fetch PO document
      const resPO = await db
        .collection("purchase_order")
        .where({ id: purchaseOrderId })
        .field("table_po,pi_status")
        .get();

      if (!resPO || !resPO.data || resPO.data.length === 0) {
        console.warn(
          `No Purchase Order document found for ID: ${purchaseOrderId}`,
        );
        return;
      }

      const poDoc = resPO.data[0];
      const poItems = poDoc.table_po || [];

      // Process PO items
      const { updatedItems, newPIStatus } = processItems(
        poItems,
        tablePi,
        poDoc.id,
        "line_po_id",
        "po_line_id",
        "quantity",
      );

      // Update PO document
      await db.collection("purchase_order").doc(poDoc.id).update({
        table_po: updatedItems,
        pi_status: newPIStatus,
      });
    } catch (error) {
      console.error(
        `Error updating Purchase Order ID ${purchaseOrderId}:`,
        error,
      );
      throw error;
    }
  });

  await Promise.all(updatePOPromises);
};

const processItems = (items, tablePi, docId, docIdKey, piLineIdKey, qtyKey) => {
  // Filter PI items for the current document
  const filteredPI = tablePi.filter((item) => item[docIdKey] === docId);

  // Filter items where item.id matches any piLineIdKey in filteredPI
  const filteredItems = items.filter((item) =>
    filteredPI.some((pi) => pi[piLineIdKey] === item.id),
  );

  // Initialize tracking
  // Exclude Child rows from status counting - they are inventory-level detail
  // and PI only references Parent/regular/Split-Parent rows
  const countableItems = items.filter(
    (item) => item.parent_or_child !== "Child",
  );
  let totalItems = countableItems.length;
  let partiallyInvoicedItems = 0;
  let fullyInvoicedItems = 0;
  const updatedItems = items.map((item) => ({ ...item }));

  // Update invoice quantities
  filteredItems.forEach((filteredItem, filteredIndex) => {
    const originalIndex = updatedItems.findIndex(
      (item) => item.id === filteredItem.id,
    );

    if (originalIndex === -1) return;

    const itemQty = parseFloat(filteredItem[qtyKey] || 0);
    const piInvoicedQty = parseFloat(
      filteredPI[filteredIndex]?.invoice_qty || 0,
    );
    const currentInvoicedQty = parseFloat(
      updatedItems[originalIndex].invoice_qty || 0,
    );
    const totalInvoicedQty = currentInvoicedQty + piInvoicedQty;

    // Update invoice quantity
    updatedItems[originalIndex].invoice_qty = totalInvoicedQty;
  });

  for (const [index, item] of updatedItems.entries()) {
    // Skip Child rows for status determination
    if (item.parent_or_child === "Child") continue;

    if (item.invoice_qty > 0) {
      partiallyInvoicedItems++;
      updatedItems[index].pi_status = "Partially Invoiced";
      if (item.invoice_qty >= item[qtyKey]) {
        fullyInvoicedItems++;
        updatedItems[index].pi_status = "Fully Invoiced";
      }
    }
  }

  // Determine new PI status
  const allItemsComplete = fullyInvoicedItems === totalItems;
  const anyItemProcessing = partiallyInvoicedItems > 0;

  console.log(allItemsComplete, anyItemProcessing);
  let newPIStatus = anyItemProcessing
    ? allItemsComplete
      ? "Fully Invoiced"
      : "Partially Invoiced"
    : "";

  return { updatedItems, newPIStatus };
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, piLineItem] of entry.table_pi.entries()) {
      piLineItem.supplier_id = entry.supplier_name || null;
      piLineItem.plant_id = entry.plant_id || null;
      piLineItem.payment_term_id = entry.invoice_payment_term_id || null;
      piLineItem.billing_state_id = entry.billing_address_state || null;
      piLineItem.billing_country_id = entry.billing_address_country || null;
      piLineItem.shipping_state_id = entry.shipping_address_state || null;
      piLineItem.shipping_country_id = entry.shipping_address_country || null;
      piLineItem.line_index = index + 1;
      piLineItem.agent_id = entry.agent_id;
    }
    return entry.table_pi;
  } catch (error) {
    throw new Error("Error processing purchase invoice.");
  }
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading();
    let entry = data;

    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "purchase_invoice_no", label: "Invoice Number" },
      { name: "invoice_date", label: "Invoice Date" },
      { name: "pi_description", label: "Description" },
      {
        name: "table_pi",
        label: "PI Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    if (
      entry.purchase_invoice_no_type !== -9999 &&
      (!entry.purchase_invoice_no ||
        entry.purchase_invoice_no === null ||
        entry.purchase_invoice_no === "" ||
        entry.previous_status === "Draft")
    ) {
      entry.purchase_invoice_no = "issued";
    }

    const missingFields = await validateForm(entry, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      entry.pi_status = "Completed";
      entry.posted_status = "Unposted";

      const latestPI = await processPILineItem(entry);

      if (latestPI.table_pi.length === 0) {
        throw new Error(
          "All Invoice Quantity must not be 0. Please add at lease one item with invoice quantity > 0.",
        );
      }

      latestPI.table_pi = await fillbackHeaderFields(latestPI);
      console.log("latestPI", latestPI);

      if (page_status === "Add") {
        await db.collection("purchase_invoice").add(latestPI);
        await updateReferenceDocStatus(latestPI);

        this.$message.success("Add successfully");
        await closeDialog();
      } else if (page_status === "Edit") {
        const purchaseInvoiceId = this.getValue("id");
        await db
          .collection("purchase_invoice")
          .doc(purchaseInvoiceId)
          .update(latestPI);
        await updateReferenceDocStatus(latestPI);

        this.$message.success("Update successfully");
        await closeDialog();
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";
    console.log(error);

    if (error && typeof error === "object") {
      errorMessage = (await findFieldMessage(error)) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
