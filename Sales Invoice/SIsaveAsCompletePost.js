// Store reference to this for consistent context
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    self.hideLoading();
  }
};

const updateSalesOrderStatus = async (salesInvoiceId) => {
  try {
    const currentSIQuery = await db
      .collection("sales_invoice")
      .where({ id: salesInvoiceId })
      .get();

    if (!currentSIQuery.data || currentSIQuery.data.length === 0) {
      console.error("Sales invoice not found:", salesInvoiceId);
      return;
    }

    const currentSI = currentSIQuery.data[0];

    const [resComp, resPost, resSO] = await Promise.all([
      db
        .collection("sales_invoice")
        .where({ si_status: "Completed", so_id: currentSI.so_id })
        .get(),
      db
        .collection("sales_invoice")
        .where({ si_status: "Fully Posted", so_id: currentSI.so_id })
        .get(),
      db.collection("sales_order").where({ id: currentSI.so_id }).get(),
    ]);

    const allSIs = [...(resComp.data || []), ...(resPost.data || [])] || [];
    const postSIs = resPost.data || [];

    if (!resSO.data || resSO.data.length === 0) {
      console.error("Sales order not found for SO ID:", currentSI.so_id);
      return;
    }

    const soData = resSO.data[0];
    const soItems = soData.table_so || [];

    // Create a map to sum received quantities for each item
    const invoicedQtyMap = {};
    const postedQtyMap = {};

    // Initialize with zeros
    soItems.forEach((item) => {
      invoicedQtyMap[item.item_name] = 0;
      postedQtyMap[item.item_name] = 0;
    });

    // Sum received quantities from all SIs
    allSIs.forEach((si) => {
      (si.table_si || []).forEach((siItem) => {
        if (invoicedQtyMap.hasOwnProperty(siItem.material_id)) {
          invoicedQtyMap[siItem.material_id] += siItem.invoice_qty || 0;
        }
      });
    });

    postSIs.forEach((si) => {
      (si.table_si || []).forEach((siItem) => {
        if (postedQtyMap.hasOwnProperty(siItem.material_id)) {
          postedQtyMap[siItem.material_id] += siItem.invoice_qty || 0;
        }
      });
    });

    let allItemsComplete = true;
    let allItemsPosted = true;
    let anyItemProcessing = false;
    let anyItemPartiallyPosted = false;

    soItems.forEach((item) => {
      const orderedQty = item.so_quantity || 0;
      const invoicedQty = invoicedQtyMap[item.item_name] || 0;
      const postedQty = postedQtyMap[item.item_name] || 0;

      if (invoicedQty < orderedQty) {
        allItemsComplete = false;
        if (invoicedQty > 0) {
          anyItemProcessing = true;
        }
      }

      if (postedQty < orderedQty) {
        allItemsPosted = false;
        if (postedQty > 0) {
          anyItemPartiallyPosted = true;
        }
      }
    });

    const newSIStatus = allItemsComplete
      ? "Fully Invoiced"
      : anyItemProcessing
      ? "Partially Invoiced"
      : soData.si_status;

    const newSIPostedStatus = allItemsPosted
      ? "Fully Posted"
      : anyItemPartiallyPosted
      ? "Partially Posted"
      : soData.si_posted_status;

    // Prepare updates
    const updates = [];

    if (newSIStatus !== soData.si_status) {
      updates.push(
        db
          .collection("sales_order")
          .doc(currentSI.so_id)
          .update({ si_status: newSIStatus })
      );
    }

    if (newSIPostedStatus !== soData.si_posted_status) {
      updates.push(
        db
          .collection("sales_order")
          .doc(currentSI.so_id)
          .update({ si_posted_status: newSIPostedStatus })
      );
    }

    // Update GDs - Only if they exist
    if (
      currentSI.goods_delivery_number &&
      Array.isArray(currentSI.goods_delivery_number)
    ) {
      const gdUpdates = currentSI.goods_delivery_number.map((gd) =>
        db
          .collection("goods_delivery")
          .doc(gd)
          .update({ si_status: "Fully Invoiced" })
      );
      updates.push(...gdUpdates);
    }

    if (updates.length > 0) {
      return Promise.all(updates);
    }

    return Promise.resolve(); // Return resolved promise if no updates needed
  } catch (error) {
    console.error("Error in updateSalesOrderStatus:", error);
    return Promise.reject(error);
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
    if (field.arrayType === "object" && field.arrayFields) {
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

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
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

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("sales_invoice")
    .where({ sales_invoice_no: generatedPrefix })
    .get();
  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (prefixData) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
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

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (!prefixData || !prefixData.id) {
      throw new Error("Invalid prefix configuration");
    }

    const { prefixToShow, runningNumber } = await findUniquePrefix(prefixData);

    // Set the generated prefix
    entry.sales_invoice_no = prefixToShow;

    // Transaction-like approach to ensure data consistency
    await updatePrefix(organizationId, runningNumber);

    const addResult = await db.collection("sales_invoice").add(entry);

    // Run workflow for the newly added invoice
    await new Promise((resolve, reject) => {
      self.runWorkflow(
        "1917950696199892993",
        { sales_invoice_no: entry.sales_invoice_no },
        (res) => {
          console.log("Workflow 1 completed successfully:", res);
          resolve(res);
        },
        (err) => {
          console.error("Workflow 1 failed:", err);
          self.$message.error(
            "Workflow execution failed: " + (err.message || "Unknown error")
          );
          reject(err);
        }
      );
    });

    // Run second workflow
    await new Promise((resolve, reject) => {
      self.runWorkflow(
        "1902567975299432449",
        { key: "value" },
        async (res) => {
          console.log("Workflow 2 completed successfully:", res);

          const siList = res.data.result || [];

          // Process all successful SIs in parallel
          try {
            await Promise.all(
              siList
                .filter((si) => si.status === "SUCCESS")
                .map((si) => updateSalesOrderStatus(si.id))
            );

            self.$message.success("Add successfully");
            closeDialog();
            resolve(res);
          } catch (updateError) {
            console.error("Error updating sales order status:", updateError);
            self.$message.error(
              "Add successful but failed to update related records"
            );
            closeDialog();
            resolve(res); // Still resolve since the add was successful
          }
        },
        (err) => {
          console.error("Workflow 2 failed:", err);
          self.$message.error(
            "Workflow execution failed: " + (err.message || "Unknown error")
          );
          reject(err);
        }
      );
    });
  } catch (error) {
    console.error("Error in addEntry:", error);
    self.$message.error(error.message || "Failed to add Sales Invoice");
    self.hideLoading();
    throw error;
  }
};

const updateEntry = async (organizationId, entry, salesInvoiceId) => {
  try {
    // For updates, we should use the existing sales_invoice_no
    // No need to generate a new one unless specifically requested

    await db.collection("sales_invoice").doc(salesInvoiceId).update(entry);

    // Run first workflow
    await new Promise((resolve, reject) => {
      self.runWorkflow(
        "1917950696199892993",
        { sales_invoice_no: entry.sales_invoice_no },
        (res) => {
          console.log("Workflow 1 completed successfully:", res);
          resolve(res);
        },
        (err) => {
          console.error("Workflow 1 failed:", err);
          self.$message.error(
            "Workflow execution failed: " + (err.message || "Unknown error")
          );
          reject(err);
        }
      );
    });

    // Run second workflow
    await new Promise((resolve, reject) => {
      self.runWorkflow(
        "1902567975299432449",
        { key: "value" },
        async (res) => {
          console.log("Workflow 2 completed successfully:", res);

          const siList = res.data.result || [];

          // Process all successful SIs in parallel
          try {
            await Promise.all(
              siList
                .filter((si) => si.status === "SUCCESS")
                .map((si) => updateSalesOrderStatus(si.id))
            );

            self.$message.success("Update successfully");
            closeDialog();
            resolve(res);
          } catch (updateError) {
            console.error("Error updating sales order status:", updateError);
            self.$message.error(
              "Update successful but failed to update related records"
            );
            closeDialog();
            resolve(res); // Still resolve since the update was successful
          }
        },
        (err) => {
          console.error("Workflow 2 failed:", err);
          self.$message.error(
            "Workflow execution failed: " + (err.message || "Unknown error")
          );
          reject(err);
        }
      );
    });
  } catch (error) {
    console.error("Error in updateEntry:", error);
    self.$message.error(error.message || "Failed to update Sales Invoice");
    self.hideLoading();
    throw error;
  }
};

// Main execution
(async () => {
  try {
    const data = self.getValues();
    self.showLoading();

    const requiredFields = [
      { name: "so_id", label: "SO Number" },
      { name: "goods_delivery_number", label: "Goods Delivery Number" },
      { name: "sales_invoice_no", label: "Sales Invoice Number " },
      { name: "sales_invoice_date", label: "Sales Invoice Date" },
      { name: "si_description", label: "Description" },
      {
        name: "table_si",
        label: "SI Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = self.getValue("page_status");

      let organizationId = self.getVarGlobal("deptParentId");
      if (!organizationId || organizationId === "0") {
        const deptIds = self.getVarSystem("deptIds");
        if (!deptIds) {
          throw new Error("No valid department ID found");
        }
        organizationId = deptIds.split(",")[0];
      }

      const {
        so_id,
        customer_id,
        si_address_name,
        si_address_contact,
        goods_delivery_number,
        sales_invoice_no,
        sales_invoice_date,
        sales_person_id,
        si_payment_term_id,
        si_description,
        plant_id,
        organization_id,
        fileupload_hmtcurne,
        so_no_display,
        table_si,
        invoice_subtotal,
        invoice_total_discount,
        invoice_taxes_amount,
        invoice_total,
        remarks,
        si_shipping_address,
        si_billing_address,
        gd_no_display,
        currency_code,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_postal_code,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_postal_code,
        shipping_address_country,
        exchange_rate,
        myr_total_amount,
      } = data;

      const entry = {
        si_status: "Completed",
        posted_status: "Pending Post",
        so_id,
        customer_id,
        si_address_name,
        si_address_contact,
        goods_delivery_number,
        sales_invoice_no,
        sales_invoice_date,
        sales_person_id,
        si_payment_term_id,
        si_description,
        plant_id,
        organization_id,
        so_no_display,
        fileupload_hmtcurne,
        table_si,
        invoice_subtotal,
        invoice_total_discount,
        invoice_taxes_amount,
        invoice_total,
        remarks,
        si_shipping_address,
        si_billing_address,
        gd_no_display,
        currency_code,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_postal_code,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_postal_code,
        shipping_address_country,
        exchange_rate,
        myr_total_amount,
      };

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        const salesInvoiceId = self.getValue("id");
        if (!salesInvoiceId) {
          throw new Error("Sales Invoice ID is required for editing");
        }
        await updateEntry(organizationId, entry, salesInvoiceId);
      } else {
        throw new Error("Unknown page status: " + page_status);
      }
    } else {
      self.hideLoading();
      self.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    console.error("Main execution error:", error);
    self.hideLoading();
    self.$message.error(error.message || "An unexpected error occurred");
  }
})();
