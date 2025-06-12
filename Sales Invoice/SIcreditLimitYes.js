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

// Updated to handle array of sales order IDs (for regular operation)
const updateSalesOrderStatus = async (
  salesOrderIds,
  tableSI,
  goodsDeliveryNo
) => {
  // Ensure salesOrderIds is an array
  const soIds = Array.isArray(salesOrderIds) ? salesOrderIds : [salesOrderIds];

  const updatePromises = soIds.map(async (salesOrderId) => {
    const resSO = await db
      .collection("sales_order")
      .where({ id: salesOrderId })
      .get();

    if (!resSO || resSO.data.length === 0) return;

    const soDoc = resSO.data[0];
    const soItems = soDoc.table_so || [];
    const filteredSI = tableSI.filter(
      (item) => item.line_so_no === soDoc.so_no
    );

    const filteredSO = soItems
      .map((item, index) => ({ ...item, originalIndex: index }))
      .filter((item) => item.item_name !== "" || item.so_desc !== "");

    // Initialize tracking objects
    let totalItems = soItems.length;
    let partiallyInvoicedItems = 0;
    let fullyInvoicedItems = 0;

    const updatedSoItems = soItems.map((item) => ({ ...item }));

    filteredSO.forEach((filteredItem, filteredIndex) => {
      const originalIndex = filteredItem.originalIndex;
      const orderQty = parseFloat(filteredItem.so_quantity || 0);
      const siInvoicedQty = parseFloat(
        filteredSI[filteredIndex]?.invoice_qty || 0
      );
      const currentInvoicedQty = parseFloat(
        updatedSoItems[originalIndex].invoice_qty || 0
      );
      const totalInvoicedQty = currentInvoicedQty + siInvoicedQty;

      // Update the quantity in the original soItems structure
      updatedSoItems[originalIndex].invoice_qty = totalInvoicedQty;

      // Add ratio for tracking purposes
      updatedSoItems[originalIndex].invoice_ratio =
        orderQty > 0 ? totalInvoicedQty / orderQty : 0;

      if (totalInvoicedQty > 0) {
        partiallyInvoicedItems++;

        // Count fully delivered items separately
        if (totalInvoicedQty >= orderQty) {
          fullyInvoicedItems++;
        }
      }
    });

    let allItemsComplete = fullyInvoicedItems === totalItems;
    let anyItemProcessing = partiallyInvoicedItems > 0;

    let newSIStatus = soDoc.si_status;

    if (allItemsComplete) {
      newSIStatus = "Fully Invoiced";
    } else if (anyItemProcessing) {
      newSIStatus = "Partially Invoiced";
    }

    const updateData = {
      table_so: updatedSoItems,
    };

    updateData.si_status = newSIStatus;

    await db.collection("sales_order").doc(soDoc.id).update(updateData);
  });

  await Promise.all(updatePromises);

  if (goodsDeliveryNo) {
    goodsDeliveryNo.forEach((gd) => {
      db.collection("goods_delivery").doc(gd).update({
        si_status: "Fully Invoiced",
      });
    });
  }
};

// Updated to handle multiple SOs (for post operation)
const updateSalesOrderStatusPost = async (salesInvoiceId) => {
  const currenctSIQuery = await db
    .collection("sales_invoice")
    .where({ id: salesInvoiceId })
    .get();
  const currentSI = currenctSIQuery.data[0];

  const soIds = Array.isArray(currentSI.so_id)
    ? currentSI.so_id
    : [currentSI.so_id];

  const tableSI = await currentSI.table_si;

  const updatePromises = soIds.map(async (salesOrderId) => {
    const resSO = await db
      .collection("sales_order")
      .where({ id: salesOrderId })
      .get();

    if (!resSO && resSO.data.length === 0) return;

    const soDoc = resSO.data[0];
    const soItems = soDoc.table_so || [];
    const filteredSI = tableSI.filter(
      (item) => item.line_so_no === soDoc.so_no
    );

    const filteredSO = soItems
      .map((item, index) => ({ ...item, originalIndex: index }))
      .filter((item) => item.item_name !== "" || item.so_desc !== "");

    let totalItems = soItems.length;
    let partiallyInvoicedItems = 0;
    let fullyInvoicedItems = 0;

    let partiallyPostedItems = 0;
    let fullyPostedItems = 0;

    const updatedSoItems = soItems.map((item) => ({ ...item }));

    filteredSO.forEach((filteredItem, filteredIndex) => {
      const originalIndex = filteredItem.originalIndex;
      const orderQty = parseFloat(filteredItem.so_quantity || 0);

      const siInvoicedQty = parseFloat(
        filteredSI[filteredIndex]?.invoice_qty || 0
      );
      const currentInvoicedQty = parseFloat(
        updatedSoItems[originalIndex].invoice_qty || 0
      );
      const totalInvoicedQty = currentInvoicedQty + siInvoicedQty;

      const siPostedQty = parseFloat(
        filteredSI[filteredIndex]?.posted_qty || 0
      );
      const currentPostedQty = parseFloat(
        updatedSoItems[originalIndex].posted_qty || 0
      );
      const totalPostedQty = currentPostedQty + siPostedQty;

      // Update the quantity in the original soItems structure
      updatedSoItems[originalIndex].invoice_qty = totalInvoicedQty;
      updatedSoItems[originalIndex].posted_qty = totalPostedQty;

      // Add ratio for tracking purposes
      updatedSoItems[originalIndex].invoice_ratio =
        orderQty > 0 ? totalInvoicedQty / orderQty : 0;
      updatedSoItems[originalIndex].posted_ratio =
        orderQty > 0 ? totalPostedQty / orderQty : 0;

      if (totalInvoicedQty > 0) {
        partiallyInvoicedItems++;
        if (totalInvoicedQty >= orderQty) {
          fullyInvoicedItems++;
        }
      }

      if (totalPostedQty > 0) {
        partiallyPostedItems++;
        if (totalPostedQty >= orderQty) {
          fullyPostedItems++;
        }
      }
    });

    let allItemsCompleteInvoiced = fullyInvoicedItems === totalItems;
    let anyItemProcessingInvoiced = partiallyInvoicedItems > 0;

    let allItemsCompletePosted = fullyPostedItems === totalItems;
    let anyItemProcessingPosted = partiallyPostedItems > 0;

    let newSIStatus = soDoc.si_status;
    let newSIPostedStatus = soDoc.si_posted_status;

    if (allItemsCompleteInvoiced) {
      newSIStatus = "Fully Invoiced";
    } else if (anyItemProcessingInvoiced) {
      newSIStatus = "Partially Invoiced";
    }

    if (allItemsCompletePosted) {
      newSIPostedStatus = "Fully Posted";
    } else if (anyItemProcessingPosted) {
      newSIPostedStatus = "Partially Posted";
    }

    const updateData = {
      table_so: updatedSoItems,
    };

    updateData.si_status = newSIStatus;
    updateData.si_posted_status = newSIPostedStatus;

    await db.collection("sales_order").doc(soDoc.id).update(updateData);
  });

  await Promise.all(updatePromises);

  const goodsDeliveryNo = currentSI.goods_delivery_number;
  if (goodsDeliveryNo) {
    goodsDeliveryNo.forEach((gd) => {
      db.collection("goods_delivery").doc(gd).update({
        si_status: "Fully Invoiced",
      });
    });
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
    }

    await db.collection("sales_invoice").add(entry);

    try {
      await self.runWorkflow(
        "1917950696199892993",
        { sales_invoice_no: entry.sales_invoice_no },
        async (res) => {
          console.log("Workflow success:", res);
        },
        (err) => {
          console.error("Workflow error:", err);
          closeDialog();
        }
      );
    } catch (workflowError) {
      console.error("Error running workflow:", workflowError);
    }

    // Handle multiple SO IDs and GD numbers
    await updateSalesOrderStatus(
      entry.so_id,
      entry.table_si,
      entry.goods_delivery_number
    );

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
    }

    await db.collection("sales_invoice").doc(salesInvoiceId).update(entry);

    try {
      await self.runWorkflow(
        "1917950696199892993",
        { sales_invoice_no: entry.sales_invoice_no },
        async (res) => {
          console.log("Workflow success:", res);
        },
        (err) => {
          console.error("Workflow error:", err);
          closeDialog();
        }
      );
    } catch (workflowError) {
      console.error("Error running workflow:", workflowError);
    }

    // Handle multiple SO IDs and GD numbers
    await updateSalesOrderStatus(
      entry.so_id,
      entry.table_si,
      entry.goods_delivery_number
    );

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
    }

    await db.collection("sales_invoice").add(entry);

    // si line item workflow
    self.runWorkflow(
      "1917950696199892993",
      { sales_invoice_no: entry.sales_invoice_no },
      (res) => {
        console.log("Workflow 1 completed successfully:", res);
      },
      (err) => {
        console.error("Workflow 1 failed:", err);
        self.$message.error(
          "Workflow execution failed: " + (err.message || "Unknown error")
        );
      }
    );

    const accIntegrationType = self.getValue("acc_integration_type");

    if (
      accIntegrationType === "SQL Accounting" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      console.log("Calling SQL Accounting workflow");

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
          self.hideLoading();
          self.$message.error("Post SI Failed: ", err);
        }
      );
    } else if (
      accIntegrationType === "AutoCount Accounting" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      self.$message.success("Add Sales Invoice successfully");
      await closeDialog();
      console.log("Calling AutoCount workflow");
    } else if (
      accIntegrationType === "No Accounting Integration" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      self.$message.success("Add Sales Invoice successfully");
      await closeDialog();
      console.log("Not calling workflow");
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
    }

    await db.collection("sales_invoice").doc(salesInvoiceId).update(entry);

    // si line item workflow
    self.runWorkflow(
      "1917950696199892993",
      { sales_invoice_no: entry.sales_invoice_no },
      (res) => {
        console.log("Workflow 1 completed successfully:", res);
      },
      (err) => {
        console.error("Workflow 1 failed:", err);
        self.$message.error(
          "Workflow execution failed: " + (err.message || "Unknown error")
        );
      }
    );

    const accIntegrationType = self.getValue("acc_integration_type");

    if (
      accIntegrationType === "SQL Accounting" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      console.log("Calling SQL Accounting workflow");

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
          self.hideLoading();
          self.$message.error("Post SI Failed: ", err);
        }
      );
    } else if (
      accIntegrationType === "AutoCount Accounting" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      self.$message.success("Update Sales Invoice successfully");
      await closeDialog();
      console.log("Calling AutoCount workflow");
    } else if (
      accIntegrationType === "No Accounting Integration" &&
      entry.organization_id &&
      entry.organization_id !== ""
    ) {
      self.$message.success("Update Sales Invoice successfully");
      await closeDialog();
      console.log("Not calling workflow");
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

      if (page_status === "Add") {
        await addEntryWithPost(organizationId, entry);
      } else if (page_status === "Edit") {
        await updateEntryWithPost(organizationId, entry, sales_invoice_id);
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

      if (page_status === "Add") {
        await addEntryRegular(organizationId, entry);
      } else if (page_status === "Edit") {
        await updateEntryRegular(organizationId, entry, sales_invoice_id);
      } else {
        console.log("Unknown page status:", page_status);
        self.hideLoading();
        self.$message.error("Invalid page status");
        return;
      }
    }
  } catch (error) {
    console.error("Error in handleYesButtonClick:", error);
    self.hideLoading();
    self.$message.error(
      error.message || "An error occurred while processing the sales invoice"
    );
  }
};

// Execute the handler
(async () => {
  self.showLoading();
  await handleYesButtonClick();
})();
