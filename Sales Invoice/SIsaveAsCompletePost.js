const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const updateSalesOrderStatus = async (salesInvoiceId) => {
  const currentSIQuery = await db
    .collection("sales_invoice")
    .where({ id: salesInvoiceId })
    .get();

  const currentSI = currentSIQuery.data[0];

  const completedQuery = db
    .collection("sales_invoice")
    .where({ si_status: "Completed", so_id: currentSI.so_id });

  const fullyPostedQuery = db
    .collection("sales_invoice")
    .where({ si_status: "Fully Posted", so_id: currentSI.so_id });

  Promise.all([
    completedQuery.get(),
    fullyPostedQuery.get(),
    db.collection("sales_order").where({ id: currentSI.so_id }).get(),
  ]).then(([resComp, resPost, resSO]) => {
    const allSIs = [...resComp.data, ...resPost.data] || [];
    const postSIs = resPost.data || [];
    const soData = resSO.data[0];

    if (!soData) return;

    const soItems = soData.table_so || [];

    // Create a map to sum received quantities for each item
    const invoicedQtyMap = {};
    const postedQtyMap = {};

    // Initialize with zeros
    soItems.forEach((item) => {
      invoicedQtyMap[item.item_name] = 0;
      postedQtyMap[item.item_name] = 0;
    });

    // Sum received quantities from all PIs
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

    // Update GRs
    currentSI.goods_delivery_number.forEach((gd) => {
      updates.push(
        db
          .collection("goods_delivery")
          .doc(gd)
          .update({ si_status: "Fully Invoiced" })
      );
    });

    return Promise.all(updates);
  });
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
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Sales Invoices",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
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

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("sales_invoice")
    .where({ sales_invoice_no: generatedPrefix })
    .get();
  return existingDoc.data[0] ? false : true;
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
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      "Could not generate a unique Sales Invoices number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData.length !== 0) {
      await updatePrefix(organizationId, prefixData.running_number);
      await db
        .collection("sales_invoice")
        .add(entry)
        .then(() => {
          this.runWorkflow(
            "1917950696199892993",
            { sales_invoice_no: entry.sales_invoice_no },
            async (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              alert();
              console.error("失败结果：", err);
              closeDialog();
            }
          );
        });
      await this.runWorkflow(
        "1902567975299432449",
        { key: "value" },
        (res) => {
          console.log("成功结果：", res);
          const siList = res.data.result;

          siList.forEach(async (si) => {
            if (si.status === "SUCCESS") {
              await updateSalesOrderStatus(si.id);
              this.$message.success("Add successfully");
              closeDialog();
            }
          });
        },
        (err) => {
          console.error("失败结果：", err);
        }
      );
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, salesInvoiceId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sales_invoice_no = prefixToShow;
      await db
        .collection("sales_invoice")
        .doc(salesInvoiceId)
        .update(entry)
        .then(() => {
          this.runWorkflow(
            "1917950696199892993",
            { sales_invoice_no: entry.sales_invoice_no },
            async (res) => {
              console.log("成功结果：", res);
            },
            (err) => {
              alert();
              console.error("失败结果：", err);
              closeDialog();
            }
          );
        });
      await this.runWorkflow(
        "1902567975299432449",
        { key: "value" },
        (res) => {
          console.log("成功结果：", res);
          const siList = res.data.result;

          siList.forEach(async (si) => {
            if (si.status === "SUCCESS") {
              await updateSalesOrderStatus(si.id);
              this.$message.success("Update successfully");
              closeDialog();
            }
          });
        },
        (err) => {
          console.error("失败结果：", err);
        }
      );
    }
  } catch (error) {
    this.$message.error(error);
  }
};

(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

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

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
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
        const salesInvoiceId = this.getValue("id");
        await updateEntry(organizationId, entry, salesInvoiceId);
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
})();
