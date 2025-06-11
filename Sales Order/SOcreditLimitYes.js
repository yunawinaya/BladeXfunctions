const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const getPrefixData = async (organizationId) => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Orders",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    console.log("Prefix data result:", prefixEntry);

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      console.log("No prefix configuration found");
      return null;
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error getting prefix data:", error);
    throw error;
  }
};

const updatePrefix = async (organizationId, runningNumber) => {
  console.log(
    "Updating prefix for organization:",
    organizationId,
    "with running number:",
    runningNumber
  );
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Orders",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({
        running_number: parseInt(runningNumber) + 1,
        has_record: 1,
      });
    console.log("Prefix update successful");
  } catch (error) {
    console.error("Error updating prefix:", error);
    throw error;
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  console.log("Generating prefix with running number:", runNumber);
  try {
    let generated = prefixData.current_prefix_config;
    generated = generated.replace("prefix", prefixData.prefix_value);
    generated = generated.replace("suffix", prefixData.suffix_value);
    generated = generated.replace(
      "month",
      String(now.getMonth() + 1).padStart(2, "0")
    );
    generated = generated.replace(
      "day",
      String(now.getDate()).padStart(2, "0")
    );
    generated = generated.replace("year", now.getFullYear());
    generated = generated.replace(
      "running_number",
      String(runNumber).padStart(prefixData.padding_zeroes, "0")
    );
    console.log("Generated prefix:", generated);
    return generated;
  } catch (error) {
    console.error("Error generating prefix:", error);
    throw error;
  }
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("sales_order")
    .where({ so_no: generatedPrefix, organization_id: organizationId })
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
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Sales Order number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      entry.so_no = prefixToShow;
      await updatePrefix(organizationId, runningNumber);
    }

    await db.collection("sales_order").add(entry);
    // await this.runWorkflow(
    //   "1917416028010524674",
    //   { so_no: entry.so_no },
    //   async (res) => {
    //     console.log("成功结果：", res);
    //   },
    //   (err) => {
    //     console.error("失败结果：", err);
    //     closeDialog();
    //   }
    // );
    this.$message.success("Add successfully");
    await closeDialog();
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, entry, salesOrderId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.so_no = prefixToShow;
    }

    await db.collection("sales_order").doc(salesOrderId).update(entry);
    // await this.runWorkflow(
    //   "1917416028010524674",
    //   { so_no: entry.so_no },
    //   async (res) => {
    //     console.log("成功结果：", res);
    //   },
    //   (err) => {
    //     alert();
    //     console.error("失败结果：", err);
    //     closeDialog();
    //   }
    // );

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    console.error("Error in updateEntry:", error);
    throw error;
  }
};

const handleYesButtonClick = async () => {
  try {
    console.log("User clicked Yes to override credit/overdue limit");

    // Get the current form data again
    const data = this.getValues();
    const page_status = data.page_status;
    const sales_order_id = data.id;

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Prepare the entry object with all fields
    const entry = {
      so_status: "Issued",
      so_no: data.so_no,
      so_date: data.so_date,
      customer_name: data.customer_name,
      so_currency: data.so_currency,
      plant_name: data.plant_name,
      organization_id: organizationId,
      partially_delivered: data.partially_delivered,
      fully_delivered: data.fully_delivered,
      cust_billing_address: data.cust_billing_address,
      cust_shipping_address: data.cust_shipping_address,
      so_payment_term: data.so_payment_term,
      so_delivery_method: data.so_delivery_method,
      so_shipping_date: data.so_shipping_date,
      so_ref_doc: data.so_ref_doc,
      cp_driver_name: data.cp_driver_name,
      cp_driver_contact_no: data.cp_driver_contact_no,
      cp_vehicle_number: data.cp_vehicle_number,
      cp_pickup_date: data.cp_pickup_date,
      cp_ic_no: data.cp_ic_no,
      validity_of_collection: data.validity_of_collection,
      cs_courier_company: data.cs_courier_company,
      cs_shipping_date: data.cs_shipping_date,
      est_arrival_date: data.est_arrival_date,
      cs_tracking_number: data.cs_tracking_number,
      ct_driver_name: data.ct_driver_name,
      ct_driver_contact_no: data.ct_driver_contact_no,
      ct_delivery_cost: data.ct_delivery_cost,
      ct_vehicle_number: data.ct_vehicle_number,
      ct_est_delivery_date: data.ct_est_delivery_date,
      ct_ic_no: data.ct_ic_no,
      ss_shipping_company: data.ss_shipping_company,
      ss_shipping_date: data.ss_shipping_date,
      ss_freight_charges: data.ss_freight_charges,
      ss_shipping_method: data.ss_shipping_method,
      ss_est_arrival_date: data.ss_est_arrival_date,
      ss_tracking_number: data.ss_tracking_number,
      table_so: data.table_so,
      so_sales_person: data.so_sales_person,
      so_total_gross: data.so_total_gross,
      so_total_discount: data.so_total_discount,
      so_total_tax: data.so_total_tax,
      so_total: data.so_total,
      so_remarks: data.so_remarks,
      so_tnc: data.so_tnc,
      so_payment_details: data.so_payment_details,
      billing_address_line_1: data.billing_address_line_1,
      billing_address_line_2: data.billing_address_line_2,
      billing_address_line_3: data.billing_address_line_3,
      billing_address_line_4: data.billing_address_line_4,
      billing_address_city: data.billing_address_city,
      billing_address_state: data.billing_address_state,
      billing_address_country: data.billing_address_country,
      billing_postal_code: data.billing_postal_code,
      shipping_address_line_1: data.shipping_address_line_1,
      shipping_address_line_2: data.shipping_address_line_2,
      shipping_address_line_3: data.shipping_address_line_3,
      shipping_address_line_4: data.shipping_address_line_4,
      shipping_address_city: data.shipping_address_city,
      shipping_address_state: data.shipping_address_state,
      shipping_address_country: data.shipping_address_country,
      shipping_postal_code: data.shipping_postal_code,
      exchange_rate: data.exchange_rate,
      myr_total_amount: data.myr_total_amount,
      sqt_no: data.sqt_no,
      tpt_vehicle_number: data.tpt_vehicle_number,
      tpt_transport_name: data.tpt_transport_name,
      tpt_ic_no: data.tpt_ic_no,
      tpt_driver_contact_no: data.tpt_driver_contact_no,
      cs_freight_charges: data.cs_freight_charges,
      billing_address_name: data.billing_address_name,
      billing_address_phone: data.billing_address_phone,
      billing_attention: data.billing_attention,
      shipping_address_name: data.shipping_address_name,
      shipping_address_phone: data.shipping_address_phone,
      shipping_attention: data.shipping_attention,
      acc_integration_type: data.acc_integration_type,
      last_sync_date: data.last_sync_date,
      customer_credit_limit: data.customer_credit_limit,
      overdue_limit: data.overdue_limit,
      outstanding_balance: data.outstanding_balance,
      overdue_inv_total_amount: data.overdue_inv_total_amount,
      is_accurate: data.is_accurate,
    };

    // Add or update based on page status
    if (page_status === "Add" || page_status === "Clone") {
      await addEntry(organizationId, entry);
    } else if (page_status === "Edit") {
      await updateEntry(organizationId, entry, sales_order_id);
    } else {
      console.log("Unknown page status:", page_status);
      this.hideLoading();
      this.$message.error("Invalid page status");
      return;
    }
  } catch (error) {
    console.error("Error in handleYesButtonClick:", error);
    this.hideLoading();
    this.$message.error(
      error.message || "An error occurred while processing the sales order"
    );
  }
};

(async () => {
  try {
    this.showLoading();
    await handleYesButtonClick();
  } catch (error) {
    console.error("Error in main execution:", error);
    this.hideLoading();
    this.$message.error("An error occurred while processing the sales order");
  }
})();
