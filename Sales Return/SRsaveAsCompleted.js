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
      document_types: "Sales Returns",
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
      document_types: "Sales Returns",
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
    .collection("sales_return")
    .where({ sales_return_no: generatedPrefix })
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
      "Could not generate a unique Sales Return number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const updateEntry = async (organizationId, entry, salesReturnId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sales_return_no = prefixToShow;
      await db
        .collection("sales_return")
        .doc(salesReturnId)
        .update(entry)
        .then(() => {
          this.runWorkflow(
            "1917417143259181058",
            { sales_return_no: entry.sales_return_no },
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
      await db
        .collection("sales_order")
        .doc(entry.sr_return_so_id)
        .update({ has_sr: true });
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      await updatePrefix(organizationId, prefixData.running_number);

      await db
        .collection("sales_return")
        .add(entry)
        .then(() => {
          this.runWorkflow(
            "1917417143259181058",
            { sales_return_no: entry.sales_return_no },
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
      await db
        .collection("sales_order")
        .doc(entry.sr_return_so_id)
        .update({ has_sr: true });
    }
  } catch (error) {
    this.$message.error(error);
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

const updateSOandGDStatus = async (sr_return_so_id, sr_return_gd_id) => {
  const soIds = Array.isArray(sr_return_so_id)
    ? sr_return_so_id
    : [sr_return_so_id];
  const gdIds = Array.isArray(sr_return_gd_id)
    ? sr_return_gd_id
    : [sr_return_gd_id];

  for (const soId of soIds) {
    await db.collection("sales_order").doc(soId).update({ has_sr: 1 });
  }

  for (const gdId of gdIds) {
    await db.collection("goods_delivery").doc(gdId).update({ has_sr: 1 });
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "sr_return_so_id", label: "SO Number" },
      { name: "sr_return_gd_id", label: "Goods Delivery Number" },
      { name: "sales_return_no", label: "Sales Return Number" },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        fake_sr_return_so_id,
        sr_return_so_id,
        sr_return_gd_id,
        sales_return_no,
        so_no_display,
        sr_return_date,
        plant_id,
        organization_id,
        sr_billing_name,
        sr_billing_cp,
        sr_billing_address,
        sr_shipping_address,
        gd_no_display,
        customer_id,
        sr_return_address_id,
        sales_pic_id,
        sr_remark,
        sr_delivery_method,
        sr_reference_doc,
        sr_driver_name,
        sr_vehicle_no,
        sr_driver_contact_no,
        sr_pickup_date,
        courier_company,
        sr_tracking_no,
        shipping_date,
        sr_est_arrival_date,
        sr_freight_charges,
        sr_est_delivery_date,
        sr_delivery_cost,
        shipping_company,
        shipping_method,
        sr_shipping_date,
        sr_tracking_number,
        sr_decision,
        sr_note,
        table_sr,
        remark,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_address_country,
        billing_postal_code,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_postal_code,
      } = data;

      const entry = {
        sr_status: "Issued",
        fake_sr_return_so_id,
        sr_return_so_id,
        sr_return_gd_id,
        sales_return_no,
        so_no_display,
        sr_return_date,
        plant_id,
        organization_id,
        gd_no_display,
        customer_id,
        sr_billing_name,
        sr_billing_cp,
        sr_billing_address,
        sr_shipping_address,
        sr_return_address_id,
        sales_pic_id,
        sr_remark,
        sr_delivery_method,
        sr_reference_doc,
        sr_driver_name,
        sr_vehicle_no,
        sr_driver_contact_no,
        sr_pickup_date,
        courier_company,
        sr_tracking_no,
        shipping_date,
        sr_est_arrival_date,
        sr_freight_charges,
        sr_est_delivery_date,
        sr_delivery_cost,
        shipping_company,
        shipping_method,
        sr_shipping_date,
        sr_tracking_number,
        sr_decision,
        sr_note,
        table_sr,
        remark,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_address_country,
        billing_postal_code,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_postal_code,
      };

      await updateSOandGDStatus(sr_return_so_id, sr_return_gd_id);

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
        this.$message.success("Add successfully");
        await closeDialog();
      } else if (page_status === "Edit") {
        const salesReturnId = this.getValue("id");
        await updateEntry(organizationId, entry, salesReturnId);
        this.$message.success("Update successfully");
        await closeDialog();
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
