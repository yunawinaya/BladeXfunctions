const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sqt_no = prefixToShow;
    }

    await db.collection("Quotation").add(entry);
    await this.runWorkflow(
      "1917416112949374977",
      { sqt_no: entry.sqt_no },
      (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
      }
    );

    this.$message.success("Add successfully");
    await closeDialog();
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, entry, quotationId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sqt_no = prefixToShow;
    }

    await db.collection("Quotation").doc(quotationId).update(entry);
    await this.runWorkflow(
      "1917416112949374977",
      { sqt_no: entry.sqt_no },
      (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
      }
    );

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const handleYesButtonClick = async () => {
  try {
    console.log("User clicked Yes to override credit/overdue limit");

    const data = this.getValues();
    const page_status = data.page_status;
    const quotation_id = data.id;

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const {
      sqt_customer_id,
      currency_code,
      sqt_billing_name,
      sqt_billing_address,
      sqt_billing_cp,
      sqt_shipping_address,
      sqt_no,
      sqt_plant,
      sqt_date,
      sqt_validity_period,
      sales_person_id,
      sqt_payment_term,
      sqt_delivery_method_id,
      cp_customer_pickup,
      cp_ic_no,
      driver_contact_no,
      courier_company,
      vehicle_number,
      pickup_date,
      shipping_date,
      ct_driver_name,
      ct_ic_no,
      ct_vehicle_number,
      ct_driver_contact_no,
      ct_est_delivery_date,
      ct_delivery_cost,
      ss_shipping_company,
      ss_shipping_method,
      ss_shipping_date,
      est_arrival_date,
      ss_freight_charges,
      ss_tracking_number,
      tpt_vehicle_number,
      tpt_transport_name,
      tpt_ic_no,
      tpt_driver_contact_no,
      validity_of_collection,
      sqt_sub_total,
      sqt_total_discount,
      sqt_total_tax,
      sqt_totalsum,
      sqt_remarks,
      table_sqt,
      sqt_ref_no,
      exchange_rate,
      myr_total_amount,
      sqt_new_customer,
      cs_tracking_number,
      cs_est_arrival_date,
      customer_type,
      freight_charges,
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
      sqt_ref_doc,
      billing_address_name,
      billing_address_phone,
      billing_attention,
      shipping_address_name,
      shipping_address_phone,
      shipping_attention,
      acc_integration_type,
      last_sync_date,
      customer_credit_limit,
      overdue_limit,
      outstanding_balance,
      overdue_inv_total_amount,
      is_accurate,
    } = data;

    const entry = {
      sqt_status: "Issued",
      organization_id: organizationId,
      validity_of_collection,
      sqt_ref_doc,
      sqt_customer_id,
      currency_code,
      sqt_billing_name,
      sqt_billing_address,
      sqt_billing_cp,
      sqt_shipping_address,
      sqt_no,
      sqt_plant,
      sqt_date,
      sqt_validity_period,
      sales_person_id,
      sqt_payment_term,
      sqt_delivery_method_id,
      cp_customer_pickup,
      cp_ic_no,
      driver_contact_no,
      courier_company,
      vehicle_number,
      pickup_date,
      shipping_date,
      ct_driver_name,
      ct_ic_no,
      ct_vehicle_number,
      ct_driver_contact_no,
      ct_est_delivery_date,
      ct_delivery_cost,
      ss_shipping_company,
      ss_shipping_method,
      ss_shipping_date,
      est_arrival_date,
      ss_freight_charges,
      ss_tracking_number,
      tpt_vehicle_number,
      tpt_transport_name,
      tpt_ic_no,
      tpt_driver_contact_no,
      customer_type,
      sqt_sub_total,
      sqt_total_discount,
      sqt_total_tax,
      sqt_totalsum,
      sqt_remarks,
      table_sqt,
      sqt_ref_no,
      exchange_rate,
      myr_total_amount,
      sqt_new_customer,
      cs_tracking_number,
      cs_est_arrival_date,
      freight_charges,
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
      billing_address_name,
      billing_address_phone,
      billing_attention,
      shipping_address_name,
      shipping_address_phone,
      shipping_attention,
      acc_integration_type,
      last_sync_date,
      customer_credit_limit,
      overdue_limit,
      outstanding_balance,
      overdue_inv_total_amount,
      is_accurate,
    };

    // Add or update based on page status
    if (page_status === "Add" || page_status === "Clone") {
      await addEntry(organizationId, entry);
    } else if (page_status === "Edit") {
      await updateEntry(organizationId, entry, quotation_id);
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
      error.message || "An error occurred while processing the quotation"
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
    this.$message.error("An error occurred while processing the quotation");
  }
})();
