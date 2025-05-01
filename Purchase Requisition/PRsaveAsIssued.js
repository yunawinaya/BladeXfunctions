const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Purchase Requisitions",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber) => {
  await db
    .collection("prefix_configuration")
    .where({
      document_types: "Purchase Requisitions",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
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
    .collection("purchase_requisition")
    .where({ pr_no: generatedPrefix })
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
    throw new Error(
      "Could not generate a unique Purchase Requisition number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const updateEntry = async (organizationId, entry, purchaseRequisitionId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.pr_no = prefixToShow;
      db.collection("purchase_requisition")
        .doc(purchaseRequisitionId)
        .update(entry);
      this.runWorkflow(
        "1914568005475704833",
        { pr_no: entry.pr_no },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          console.error("失败结果：", err);
          closeDialog();
        }
      );
    }
  } catch (error) {
    throw new Error(error);
  }
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      await updatePrefix(organizationId, runningNumber);

      db.collection("purchase_requisition").add(entry);
      this.runWorkflow(
        "1914568005475704833",
        { pr_no: entry.pr_no },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          console.error("失败结果：", err);
          closeDialog();
        }
      );
    }
  } catch (error) {
    throw new Error(error);
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return !value;
  });
  return missingFields;
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "supplier_type", label: "Supplier Type" },
      { name: "pr_no", label: "Requisition Number" },
      { name: "plant_id", label: "Plant" },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        pr_supplier_name,
        currency_code,
        fileupload_nan36jqt,
        pr_no,
        organization_id,
        plant_id,
        preq_billing_name,
        preq_billing_cp,
        preq_billing_address,
        preq_shipping_address,
        supplier_type,
        pr_new_supplier_name,
        pr_date,
        pr_delivery_date,
        pr_ship_preference_id,
        pr_payment_term_id,
        pr_requestor,
        table_pr,
        pr_sub_total,
        pr_discount_total,
        pr_total_tax_fee,
        pr_total_price,
        pr_remark,
        pr_term_condition,
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
        preq_status: "Issued",
        pr_no,
        pr_supplier_name,
        currency_code,
        fileupload_nan36jqt,
        organization_id,
        plant_id,
        preq_billing_name,
        preq_billing_cp,
        preq_billing_address,
        preq_shipping_address,
        supplier_type,
        pr_new_supplier_name,
        pr_date,
        pr_delivery_date,
        pr_ship_preference_id,
        pr_payment_term_id,
        pr_requestor,
        table_pr,
        pr_sub_total,
        pr_discount_total,
        pr_total_tax_fee,
        pr_total_price,
        pr_remark,
        pr_term_condition,
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

      if (page_status === "Add" || page_status === "Clone") {
        await addEntry(organizationId, entry);
        closeDialog();
      } else if (page_status === "Edit") {
        const purchaseRequisitionId = this.getValue("id");
        await updateEntry(organizationId, entry, purchaseRequisitionId);
        closeDialog();
      }
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
