// Store reference to this for consistent context
const self = this;

// Function definitions that need to be in scope
const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    self.hideLoading();
  }
};
const updateReferenceDocStatus = async (data) => {
  // Validate input data
  if (!data || !data.so_id || !data.table_si) {
    throw new Error("Invalid input data: so_id and table_si are required");
  }

  const soIds = Array.isArray(data.so_id) ? data.so_id : [data.so_id];

  // Process Goods Receiving (GR) documents if doc_type is "Goods Receiving"
  if (data.gd_id.length > 0) {
    const gdIds = Array.isArray(data.gd_id) ? data.gd_id : [data.gd_id];
    await updateGoodsDelivery(gdIds, data.table_si);
  }

  // Process Purchase Order (PO) documents
  await updateSalesOrder(soIds, data.table_si);
};

// Updated to handle array of sales order IDs (for regular operation)
const updateGoodsDelivery = async (gdIds, tableSi) => {
  const updateGDPromises = gdIds.map(async (goodsDeliveryId) => {
    try {
      // Fetch GR document
      const resGD = await db
        .collection("goods_delivery")
        .where({ id: goodsDeliveryId })
        .field("table_gd,si_status")
        .get();

      if (!resGD || !resGD.data || resGD.data.length === 0) {
        console.warn(
          `No Goods Delivery document found for ID: ${goodsDeliveryId}`
        );
        return;
      }

      const gdDoc = resGD.data[0];
      const gdItems = gdDoc.table_gd || [];

      // Process GR items
      const { updatedItems, newSIStatus } = processItems(
        gdItems,
        tableSi,
        gdDoc.id,
        "line_gd_id",
        "gd_line_id",
        "gd_qty",
        false
      );

      // Update GR document
      await db.collection("goods_delivery").doc(gdDoc.id).update({
        table_gd: updatedItems,
        si_status: newSIStatus,
      });
    } catch (error) {
      console.error(
        `Error updating Goods Delivery ID ${goodsDeliveryId}:`,
        error
      );
      throw error;
    }
  });

  await Promise.all(updateGDPromises);
};

const updateSalesOrder = async (soIds, tableSi) => {
  const updateSOPromises = soIds.map(async (salesOrderId) => {
    try {
      // Fetch PO document
      const resSO = await db
        .collection("sales_order")
        .where({ id: salesOrderId })
        .field("table_so,si_status")
        .get();

      if (!resSO || !resSO.data || resSO.data.length === 0) {
        console.warn(`No Sales Order document found for ID: ${salesOrderId}`);
        return;
      }

      const soDoc = resSO.data[0];
      const soItems = soDoc.table_so || [];

      // Process PO items
      const { updatedItems, newSIStatus } = processItems(
        soItems,
        tableSi,
        soDoc.id,
        "line_so_id",
        "so_line_id",
        "so_quantity",
        false
      );

      // Update PO document
      await db.collection("sales_order").doc(soDoc.id).update({
        table_so: updatedItems,
        si_status: newSIStatus,
      });
    } catch (error) {
      console.error(`Error updating Sales Order ID ${salesOrderId}:`, error);
      throw error;
    }
  });

  await Promise.all(updateSOPromises);
};

const processItems = (
  items,
  tableSi,
  docId,
  docIdKey,
  siLineIdKey,
  qtyKey,
  processPosted
) => {
  // Filter PI items for the current document
  const filteredSI = tableSi.filter((item) => item[docIdKey] === docId);

  // Filter items where item.id matches any siLineIdKey in filteredSI
  const filteredItems = items.filter((item) =>
    filteredSI.some((pi) => pi[siLineIdKey] === item.id)
  );

  // Initialize tracking
  let totalItems = items.length;
  let partiallyInvoicedItems = 0;
  let fullyInvoicedItems = 0;
  let partiallyPostedItems = 0;
  let fullyPostedItems = 0;
  const updatedItems = items.map((item) => ({ ...item }));

  // Update invoice quantities
  filteredItems.forEach((filteredItem, filteredIndex) => {
    const originalIndex = updatedItems.findIndex(
      (item) => item.id === filteredItem.id
    );

    if (originalIndex === -1) return;

    const itemQty = parseFloat(filteredItem[qtyKey] || 0);
    const piInvoicedQty = parseFloat(
      filteredSI[filteredIndex]?.invoice_qty || 0
    );
    const currentInvoicedQty = parseFloat(
      updatedItems[originalIndex].invoice_qty || 0
    );
    const totalInvoicedQty = currentInvoicedQty + piInvoicedQty;

    // Update invoice quantity
    updatedItems[originalIndex].invoice_qty = totalInvoicedQty;

    // Update posted quantity (only for PO)
    if (processPosted) {
      const currentPostedQty = parseFloat(
        updatedItems[originalIndex].posted_qty || 0
      );
      const totalPostedQty = currentPostedQty + piInvoicedQty;
      updatedItems[originalIndex].posted_qty = totalPostedQty;
    }
  });

  if (!processPosted) {
    for (const [index, item] of updatedItems.entries()) {
      if (item.invoice_qty > 0) {
        partiallyInvoicedItems++;
        updatedItems[index].si_status = "Partially Invoiced";
        if (item.invoice_qty >= item[qtyKey]) {
          fullyInvoicedItems++;
          updatedItems[index].si_status = "Fully Invoiced";
        }
      }
    }
  }

  if (processPosted) {
    for (const item of updatedItems) {
      if (item.posted_qty > 0) {
        partiallyPostedItems++;
        if (item.posted_qty >= item[qtyKey]) {
          fullyPostedItems++;
        }
      }
    }
  }

  let newSIStatus = "";
  // Determine new PI status
  if (!processPosted) {
    const allItemsComplete = fullyInvoicedItems === totalItems;
    const anyItemProcessing = partiallyInvoicedItems > 0;
    newSIStatus = anyItemProcessing
      ? allItemsComplete
        ? "Fully Invoiced"
        : "Partially Invoiced"
      : "";
  }

  // Determine new PI posted status (only for PO)
  let newSIPostedStatus = "";
  if (processPosted) {
    const allItemsCompletePosted = fullyPostedItems === totalItems;
    const anyItemProcessingPosted = partiallyPostedItems > 0;
    newSIPostedStatus = anyItemProcessingPosted
      ? allItemsCompletePosted
        ? "Fully Posted"
        : "Partially Posted"
      : "";
  }

  return { updatedItems, newSIStatus, newSIPostedStatus };
};

// Updated to handle multiple SOs (for post operation)
const updateSalesOrderStatusPost = async (salesInvoiceId) => {
  try {
    const currenctSIQuery = await db
      .collection("sales_invoice")
      .where({ id: salesInvoiceId })
      .get();
    const currentSI = currenctSIQuery.data[0];

    const soIds = Array.isArray(currentSI.so_id)
      ? currentSI.so_id
      : [currentSI.so_id];

    const tableSi = await currentSI.table_si;

    const updateSOPromises = soIds.map(async (salesOrderId) => {
      try {
        // Fetch PO document
        const resSO = await db
          .collection("sales_order")
          .where({ id: salesOrderId })
          .field("table_so,si_posted_status")
          .get();

        if (!resSO || !resSO.data || resSO.data.length === 0) {
          console.warn(`No Sales Order document found for ID: ${salesOrderId}`);
          return;
        }

        const soDoc = resSO.data[0];
        const soItems = soDoc.table_so || [];

        // Process PO items
        const { updatedItems, newSIPostedStatus } = processItems(
          soItems,
          tableSi,
          soDoc.id,
          "line_so_id",
          "so_line_id",
          "so_quantity",
          true
        );

        // Update PO document
        await db.collection("sales_order").doc(soDoc.id).update({
          table_so: updatedItems,
          si_posted_status: newSIPostedStatus,
        });
      } catch (error) {
        console.error(`Error updating Sales Order ID ${salesOrderId}:`, error);
        throw error;
      }
    });

    await Promise.all(updateSOPromises);
  } catch (error) {
    throw new Error("An error occurred.");
  }
};

const getPrefixData = async (organizationId) => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Invoices",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      throw new Error("No prefix configuration found for organization");
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error fetching prefix data:", error);
    throw error;
  }
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Invoices",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
  } catch (error) {
    console.error("Error updating prefix:", error);
    self.$message.error("Failed to update prefix: " + error.message);
    throw error;
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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("sales_invoice")
    .where({
      sales_invoice_no: generatedPrefix,
      organization_id: organizationId,
    })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Sales Invoices number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

// Different addEntry functions based on whether it's a regular save or post operation
const addEntryRegular = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sales_invoice_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        entry.sales_invoice_no,
        organizationId
      );
      if (!isUnique) {
        throw new Error(
          `SI Number "${entry.sales_invoice_no}" already exists. Please use a different number.`
        );
      }
    }

    await db.collection("sales_invoice").add(entry);
    // Handle multiple SO IDs and GD numbers
    await updateReferenceDocStatus(entry);

    self.$message.success("Add successfully");
    closeDialog();
  } catch (error) {
    console.error("Error adding entry:", error);
    throw error;
  }
};

const updateEntryRegular = async (organizationId, entry, salesInvoiceId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sales_invoice_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        entry.sales_invoice_no,
        organizationId
      );
      if (!isUnique) {
        throw new Error(
          `SI Number "${entry.sales_invoice_no}" already exists. Please use a different number.`
        );
      }
    }

    await db.collection("sales_invoice").doc(salesInvoiceId).update(entry);

    // Handle multiple SO IDs and GD numbers
    await updateReferenceDocStatus(entry);

    self.$message.success("Update successfully");
    closeDialog();
  } catch (error) {
    console.error("Error updating entry:", error);
    throw error;
  }
};

// Add/Update functions for posting operation (with accounting integration)
const addEntryWithPost = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sales_invoice_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        entry.sales_invoice_no,
        organizationId
      );
      if (!isUnique) {
        throw new Error(
          `SI Number "${entry.sales_invoice_no}" already exists. Please use a different number.`
        );
      }
    }

    await db.collection("sales_invoice").add(entry);

    // Handle multiple SO IDs and GD numbers
    await updateReferenceDocStatus(entry);

    const accIntegrationType = self.getValue("acc_integration_type");

    if (
      accIntegrationType === "SQL Accounting" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      await self.runWorkflow(
        "1958732352162164738",
        { key: "value" },
        async (res) => {
          console.log("成功结果：", res);
          if (res.data.status === "running") {
            self.runWorkflow(
              "1925444406441488386",
              { key: "value" },
              (res) => {
                console.log("Post SI Success: ", res);
                const siList = res.data.result;

                siList.forEach(async (si) => {
                  if (si.status === "SUCCESS") {
                    await self.runWorkflow(
                      "1902566784276480001",
                      { cust_id: si.cust_id },
                      async (res) => {
                        await updateSalesOrderStatusPost(si.id);
                        self.$message.success("Post successfully");
                        closeDialog();
                      },
                      (err) => {
                        self.hideLoading();
                        self.$message.error("Post SI Failed: ", err);
                      }
                    );
                  }
                });
                self.$message.success("Add Sales Invoice successfully");
                closeDialog();
              },
              (err) => {
                closeDialog();
                console.error("Post SI Failed: ", err);
                throw new Error("An error occurred.");
              }
            );
          }
        },
        (err) => {
          console.log("失败结果：", err);

          self.hideLoading();
          throw new Error(
            "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
          );
        }
      );
    } else if (
      accIntegrationType === "AutoCount Accounting" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      self.$message.success("Add Sales Invoice successfully");
      await closeDialog();
    } else if (
      accIntegrationType === "No Accounting Integration" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      self.$message.success("Add Sales Invoice successfully");
      await closeDialog();
    } else {
      await closeDialog();
    }
  } catch (error) {
    console.error("Error in addEntry:", error);
    self.$message.error(error.message || "Failed to add Sales Invoice");
    self.hideLoading();
    throw error;
  }
};

const updateEntryWithPost = async (organizationId, entry, salesInvoiceId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sales_invoice_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        entry.sales_invoice_no,
        organizationId
      );
      if (!isUnique) {
        throw new Error(
          `SI Number "${entry.sales_invoice_no}" already exists. Please use a different number.`
        );
      }
    }

    await db.collection("sales_invoice").doc(salesInvoiceId).update(entry);

    // Handle multiple SO IDs and GD numbers
    await updateReferenceDocStatus(entry);

    const accIntegrationType = self.getValue("acc_integration_type");

    if (
      accIntegrationType === "SQL Accounting" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      await self.runWorkflow(
        "1958732352162164738",
        { key: "value" },
        async (res) => {
          console.log("成功结果：", res);
          if (res.data.status === "running") {
            self.runWorkflow(
              "1925444406441488386",
              { key: "value" },
              (res) => {
                console.log("Post SI Success: ", res);
                const siList = res.data.result;

                siList.forEach(async (si) => {
                  if (si.status === "SUCCESS") {
                    await self.runWorkflow(
                      "1902566784276480001",
                      { cust_id: si.cust_id },
                      async (res) => {
                        await updateSalesOrderStatusPost(si.id);
                        self.$message.success("Post successfully");
                        closeDialog();
                      },
                      (err) => {
                        self.hideLoading();
                        self.$message.error("Post SI Failed: ", err);
                      }
                    );
                  }
                });
                self.$message.success("Update Sales Invoice successfully");
                closeDialog();
              },
              (err) => {
                closeDialog();
                console.error("Post SI Failed: ", err);
                throw new Error("An error occurred.");
              }
            );
          }
        },
        (err) => {
          console.log("失败结果：", err);

          self.hideLoading();
          throw new Error(
            "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
          );
        }
      );
    } else if (
      accIntegrationType === "AutoCount Accounting" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      self.$message.success("Update Sales Invoice successfully");
      await closeDialog();
    } else if (
      accIntegrationType === "No Accounting Integration" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      self.$message.success("Update Sales Invoice successfully");
      await closeDialog();
    } else {
      await closeDialog();
    }
  } catch (error) {
    console.error("Error in updateEntry:", error);
    self.$message.error(error.message || "Failed to update Sales Invoice");
    self.hideLoading();
    throw error;
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
  }
  return null;
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, siLineItem] of entry.table_si.entries()) {
      siLineItem.customer_id = entry.customer_id || null;
      siLineItem.plant_id = entry.plant_id || null;
      siLineItem.payment_term_id = entry.si_payment_term_id || null;
      siLineItem.billing_state_id = entry.billing_address_state || null;
      siLineItem.billing_country_id = entry.billing_address_country || null;
      siLineItem.shipping_state_id = entry.shipping_address_state || null;
      siLineItem.shipping_country_id = entry.shipping_address_country || null;
      siLineItem.line_index = index + 1;
      siLineItem.agent_id = entry.sales_person_id;
    }
    return entry.table_si;
  } catch (error) {
    throw new Error("Error processing sales invoice.");
  }
};

const processSILineItem = async (entry) => {
  const totalQuantity = entry.table_si.reduce((sum, item) => {
    const { invoice_qty } = item;
    return sum + (invoice_qty || 0); // Handle null/undefined received_qty
  }, 0);

  if (totalQuantity === 0) {
    throw new Error("Total invoiced quantity is 0.");
  }

  const zeroQtyArray = [];
  for (const [index, si] of entry.table_si.entries()) {
    if (si.invoice_qty <= 0) {
      zeroQtyArray.push(`#${index + 1}`);
    }
  }

  if (zeroQtyArray.length > 0) {
    this.$confirm(
      `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
        zeroQtyArray.length > 1 ? "ve" : "s"
      } a zero invoice quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 invoice quantity. \nWould you like to proceed?`,
      "Zero Invoice Quantity Detected",
      {
        confirmButtonText: "OK",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: false,
      }
    )
      .then(async () => {
        console.log("User clicked OK");
        entry.table_si = entry.table_si.filter((item) => item.invoice_qty > 0);
        let soID = [];
        let gdID = [];
        let salesOrderNumber = [];
        let goodsDeliveryNumber = [];
        for (const si of entry.table_si) {
          if (si.line_gd_id && si.line_gd_id !== "") {
            gdID.push(si.line_gd_id);
            goodsDeliveryNumber.push(si.line_gd_no);
          }

          soID.push(si.line_so_id);
          salesOrderNumber.push(si.line_so_no);
        }

        soID = [...new Set(soID)];
        gdID = [...new Set(gdID)];
        salesOrderNumber = [...new Set(salesOrderNumber)];
        goodsDeliveryNumber = [...new Set(goodsDeliveryNumber)];

        entry.so_id = soID;
        entry.gd_id = gdID;
        entry.so_no_display = salesOrderNumber.join(", ");
        entry.gd_no_display = goodsDeliveryNumber.join(", ");

        return entry;
      })
      .catch(() => {
        // Function to execute when the user clicks "Cancel" or closes the dialog
        console.log("User clicked Cancel or closed the dialog");
        this.hideLoading();
        throw new Error("Saving sales invoice cancelled.");
        // Add your logic to stop or handle cancellation here
        // Example: this.stopFunction();
      });
  }

  return entry;
};

// Yes button handler for credit limit override
const handleYesButtonClick = async () => {
  try {
    console.log("User clicked Yes to override credit/overdue limit");

    // Get the is_posted flag
    const isPosted = self.getValue("is_posted");

    // Clear the is_posted flag
    self.setData({ is_posted: 0 });

    // Get the current form data
    const data = self.getValues();
    const page_status = data.page_status;
    const sales_invoice_id = data.id;

    // Get organization ID
    let organizationId = self.getVarGlobal("deptParentId");
    if (!organizationId || organizationId === "0") {
      const deptIds = self.getVarSystem("deptIds");
      if (!deptIds) {
        throw new Error("No valid department ID found");
      }
      organizationId = deptIds.split(",")[0];
    }

    // Ensure arrays for multiple SO/GD handling
    const so_id = Array.isArray(data.so_id) ? data.so_id : [data.so_id];
    const goods_delivery_number = Array.isArray(data.goods_delivery_number)
      ? data.goods_delivery_number
      : [data.goods_delivery_number];

    if (isPosted === 1) {
      const entry = {
        si_status: "Completed",
        posted_status: "Pending Post",
        fake_so_id: data.fake_so_id,
        so_id: so_id,
        customer_id: data.customer_id,
        goods_delivery_number: goods_delivery_number,
        sales_invoice_no: data.sales_invoice_no,
        sales_invoice_date: data.sales_invoice_date,
        sales_person_id: data.sales_person_id,
        si_payment_term_id: data.si_payment_term_id,
        si_description: data.si_description,
        plant_id: data.plant_id,
        organization_id: data.organization_id || organizationId,
        so_no_display: data.so_no_display,
        table_si: data.table_si,
        invoice_subtotal: data.invoice_subtotal,
        invoice_total_discount: data.invoice_total_discount,
        invoice_taxes_amount: data.invoice_taxes_amount,
        invoice_total: data.invoice_total,
        remarks: data.remarks,
        remarks2: data.remarks2,
        remarks3: data.remarks3,
        si_shipping_address: data.si_shipping_address,
        si_billing_address: data.si_billing_address,
        gd_no_display: data.gd_no_display,
        currency_code: data.currency_code,
        billing_address_line_1: data.billing_address_line_1,
        billing_address_line_2: data.billing_address_line_2,
        billing_address_line_3: data.billing_address_line_3,
        billing_address_line_4: data.billing_address_line_4,
        billing_address_city: data.billing_address_city,
        billing_address_state: data.billing_address_state,
        billing_postal_code: data.billing_postal_code,
        billing_address_country: data.billing_address_country,
        billing_address_name: data.billing_address_name,
        billing_address_phone: data.billing_address_phone,
        billing_attention: data.billing_attention,
        shipping_address_line_1: data.shipping_address_line_1,
        shipping_address_line_2: data.shipping_address_line_2,
        shipping_address_line_3: data.shipping_address_line_3,
        shipping_address_line_4: data.shipping_address_line_4,
        shipping_address_city: data.shipping_address_city,
        shipping_address_state: data.shipping_address_state,
        shipping_postal_code: data.shipping_postal_code,
        shipping_address_country: data.shipping_address_country,
        shipping_address_name: data.shipping_address_name,
        shipping_address_phone: data.shipping_address_phone,
        shipping_attention: data.shipping_attention,
        exchange_rate: data.exchange_rate,
        myr_total_amount: data.myr_total_amount,
        si_ref_doc: data.si_ref_doc,
        acc_integration_type: data.acc_integration_type,
        last_sync_date: data.last_sync_date,
        customer_credit_limit: data.customer_credit_limit,
        overdue_limit: data.overdue_limit,
        outstanding_balance: data.outstanding_balance,
        overdue_inv_total_amount: data.overdue_inv_total_amount,
        is_accurate: data.is_accurate,
      };

      const latestSI = await processSILineItem(entry);
      if (latestSI.table_si.length === 0) {
        throw new Error(
          "All Invoiced Quantity must not be 0. Please add at lease one item with invoice quantity > 0."
        );
      }

      latestSI.table_si = await fillbackHeaderFields(latestSI);
      console.log("latestSI", latestSI);

      if (page_status === "Add") {
        await addEntryWithPost(organizationId, latestSI);
      } else if (page_status === "Edit") {
        await updateEntryWithPost(organizationId, latestSI, sales_invoice_id);
      } else {
        console.log("Unknown page status:", page_status);
        self.hideLoading();
        self.$message.error("Invalid page status");
        return;
      }
    } else {
      const entry = {
        si_status: "Completed",
        posted_status: "Unposted",
        fake_so_id: data.fake_so_id,
        so_id: so_id,
        customer_id: data.customer_id,
        goods_delivery_number: goods_delivery_number,
        sales_invoice_no: data.sales_invoice_no,
        sales_invoice_date: data.sales_invoice_date,
        sales_person_id: data.sales_person_id,
        si_payment_term_id: data.si_payment_term_id,
        si_description: data.si_description,
        plant_id: data.plant_id,
        organization_id: data.organization_id || organizationId,
        so_no_display: data.so_no_display,
        table_si: data.table_si,
        invoice_subtotal: data.invoice_subtotal,
        invoice_total_discount: data.invoice_total_discount,
        invoice_taxes_amount: data.invoice_taxes_amount,
        invoice_total: data.invoice_total,
        remarks: data.remarks,
        remarks2: data.remarks2,
        remarks3: data.remarks3,
        si_shipping_address: data.si_shipping_address,
        si_billing_address: data.si_billing_address,
        gd_no_display: data.gd_no_display,
        currency_code: data.currency_code,
        billing_address_line_1: data.billing_address_line_1,
        billing_address_line_2: data.billing_address_line_2,
        billing_address_line_3: data.billing_address_line_3,
        billing_address_line_4: data.billing_address_line_4,
        billing_address_city: data.billing_address_city,
        billing_address_state: data.billing_address_state,
        billing_postal_code: data.billing_postal_code,
        billing_address_country: data.billing_address_country,
        billing_address_name: data.billing_address_name,
        billing_address_phone: data.billing_address_phone,
        billing_attention: data.billing_attention,
        shipping_address_line_1: data.shipping_address_line_1,
        shipping_address_line_2: data.shipping_address_line_2,
        shipping_address_line_3: data.shipping_address_line_3,
        shipping_address_line_4: data.shipping_address_line_4,
        shipping_address_city: data.shipping_address_city,
        shipping_address_state: data.shipping_address_state,
        shipping_postal_code: data.shipping_postal_code,
        shipping_address_country: data.shipping_address_country,
        shipping_address_name: data.shipping_address_name,
        shipping_address_phone: data.shipping_address_phone,
        shipping_attention: data.shipping_attention,
        exchange_rate: data.exchange_rate,
        myr_total_amount: data.myr_total_amount,
        si_ref_doc: data.si_ref_doc,
        acc_integration_type: data.acc_integration_type,
        last_sync_date: data.last_sync_date,
        customer_credit_limit: data.customer_credit_limit,
        overdue_limit: data.overdue_limit,
        outstanding_balance: data.outstanding_balance,
        overdue_inv_total_amount: data.overdue_inv_total_amount,
        is_accurate: data.is_accurate,
      };

      const latestSI = await processSILineItem(entry);
      if (latestSI.table_si.length === 0) {
        throw new Error(
          "All Invoiced Quantity must not be 0. Please add at lease one item with invoice quantity > 0."
        );
      }

      latestSI.table_si = await fillbackHeaderFields(latestSI);
      console.log("latestSI", latestSI);

      if (page_status === "Add") {
        await addEntryRegular(organizationId, latestSI);
      } else if (page_status === "Edit") {
        await updateEntryRegular(organizationId, latestSI, sales_invoice_id);
      } else {
        console.log("Unknown page status:", page_status);
        self.hideLoading();
        self.$message.error("Invalid page status");
        return;
      }
    }
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
};

// Execute the handler
(async () => {
  self.showLoading();
  await handleYesButtonClick();
  console.log("Credit limit override by:", self.getVarGlobal("nickname"));
})();
