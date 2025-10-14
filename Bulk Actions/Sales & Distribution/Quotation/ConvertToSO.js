const handleSingleSO = async (sqtRecords) => {
  console.log("Handle Single SO");
  try {
    const sqtData = await fetchSQTData(sqtRecords);
    console.log("Fetched SQT Data:", sqtData);

    const sqtIDs = sqtData.map((sqt) => sqt.id);
    console.log("SQT IDs to be linked:", sqtIDs);

    const sqtNos = sqtData.map((sqt) => sqt.sqt_no).join(", ");
    console.log("SQT Numbers to be linked:", sqtNos);
    // Ensure all selected SQTs are for the same customer

    const uniqueCustomers = new Set(sqtData.map((sqt) => sqt.sqt_customer_id));
    const allSameCustomer = uniqueCustomers.size === 1;

    if (!allSameCustomer) {
      this.$alert(
        "All selected quotations must be from the same customer to create a single sales order.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        }
      );
      return;
    }

    let soLineItemPromises = [];
    let lineIndex = 0;
    for (const sqt of sqtData) {
      const lineItem = sqt.table_sqt || [];
      for (const item of lineItem) {
        lineIndex++;
        const lineItemPromise = await mapLineItemToSOLine(item, sqt, lineIndex);

        soLineItemPromises.push(lineItemPromise);
      }
    }

    const data = sqtData[0];
    const lineItemLength = soLineItemPromises.length;
    const soPrefix = "";
    const plantID = "";
    const soData = await mapToSOData(
      data,
      soLineItemPromises,
      lineItemLength,
      soPrefix,
      sqtIDs,
      sqtNos,
      plantID
    );
    console.log("Mapped SO Data:", soData);

    await this.toView({
      target: "1902773735979597826",
      type: "add",
      data: { ...soData },
      position: "rtl",
      mode: "dialog",
      width: "80%",
      title: "Add",
    });
  } catch (error) {
    console.error("Error in handleSingleSO:", error);
  }
};

const handleMultipleSO = async (sqtRecords) => {
  console.log("Handle Multiple SO");
  try {
    const sqtData = await fetchSQTData(sqtRecords);
    console.log("Fetched SQT Data:", sqtData);

    let soDataPromises = [];

    for (const sqt of sqtData) {
      let soLineItemPromises = [];
      const lineItem = sqt.table_sqt || [];
      for (const [index, item] of lineItem.entries()) {
        const lineItemPromise = await mapLineItemToSOLine(item, sqt, index + 1);

        soLineItemPromises.push(lineItemPromise);
      }

      const lineItemLength = soLineItemPromises.length;
      const soPrefix = await generateSOPrefix(sqt.organization_id);
      const soData = await mapToSOData(
        sqt,
        soLineItemPromises,
        lineItemLength,
        soPrefix,
        [sqt.id],
        sqt.sqt_no,
        sqt.sqt_plant
      );
      console.log("Mapped SO Data:", soData);
      soDataPromises.push(soData);
    }

    console.log("All SO Data to be added:", soDataPromises);

    const resSO = await Promise.all(
      soDataPromises.map((soData) => db.collection("sales_order").add(soData))
    );

    const soData = resSO.map((response) => response.data[0]);
    console.log("Created SO Records:", soData);

    await this.refresh();
    await this.$alert(
      `Successfully created ${soData.length} draft sales orders.<br><br>
      <strong>Sales Order Numbers:</strong><br> ${soData
        .map((item) => item.so_no)
        .join("<br>")}`,
      "Success Converted to Sales Orders",
      {
        confirmButtonText: "OK",
        dangerouslyUseHTMLString: true,
        type: "success",
      }
    );
  } catch (error) {
    console.error("Error in handleMultipleSO:", error);
  }
};

const fetchSQTData = async (sqtRecords) => {
  try {
    const resSqt = await Promise.all(
      sqtRecords.map((item) => db.collection("Quotation").doc(item.id).get())
    );

    const sqtData = resSqt.map((response) => response.data[0]);
    return sqtData;
  } catch (error) {
    console.error("Error fetching SQT data:", error);
    throw error;
  }
};

const generateSOPrefix = async (organizationID) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Sales Orders",
      is_deleted: 0,
      organization_id: organizationID,
    })
    .get();

  if (!prefixEntry.data || prefixEntry.data.length === 0) {
    throw new Error("No prefix configuration found");
  }

  const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
  const soPrefix = `DRAFT-${prefixEntry.data[0].prefix_value}-` + currDraftNum;

  await db
    .collection("prefix_configuration")
    .where({
      document_types: "Sales Orders",
      is_deleted: 0,
      organization_id: organizationID,
    })
    .update({ draft_number: currDraftNum });

  return soPrefix;
};

const mapLineItemToSOLine = async (item, sqt, lineIndex) => {
  return {
    item_name: item.material_id,
    item_id: item.material_name,
    so_desc: item.sqt_desc,
    so_quantity: item.quantity,
    so_item_uom: item.sqt_order_uom_id,
    so_item_price: item.unit_price,
    so_gross: item.sqt_gross,
    more_desc: item.more_desc,
    line_remark_1: item.line_remark_1,
    line_remark_2: item.line_remark_2,
    so_discount: item.sqt_discount,
    so_discount_uom: item.sqt_discount_uom_id,
    so_discount_amount: item.sqt_discount_amount,
    so_tax_preference: item.sqt_taxes_rate_id,
    so_tax_percentage: item.sqt_tax_rate_percent,
    so_tax_amount: item.sqt_taxes_fee_amount,
    so_tax_inclusive: item.sqt_tax_inclusive,
    so_brand: item.sqt_brand_id,
    so_packaging_style: item.sqt_packaging_id,
    so_amount: item.total_price,
    plant_id: sqt.sqt_plant || null,
    item_category_id: item.item_category_id,
    customer_id: sqt.sqt_customer_id || null,
    payment_term_id: sqt.sqt_payment_term || null,
    sales_person_id: sqt.sales_person_id || null,
    billing_state_id: sqt.billing_address_state || null,
    billing_country_id: sqt.billing_address_country || null,
    shipping_state_id: sqt.shipping_address_state || null,
    shipping_country_id: sqt.shipping_address_country || null,
    sqt_id: sqt.id || null,
    sqt_created_by_id: sqt.create_user || null,
    organization_id: sqt.organization_id,
    line_status: "Draft",
    line_index: lineIndex,
    access_group: sqt.access_group,
  };
};

const mapToSOData = async (
  data,
  soLineItemPromises,
  lineItemLength,
  soPrefix,
  sqtIDs,
  sqtNos,
  plantID
) => {
  return {
    so_status: "Draft",
    so_no: soPrefix,
    sqt_no: sqtNos,
    sqt_id: sqtIDs,
    so_date: new Date(),
    so_sales_person: data.sales_person_id,
    customer_name: data.sqt_customer_id || "",
    so_currency: data.currency_code,
    organization_id: data.organization_id,
    plant_name: plantID || "",
    cust_billing_address: data.sqt_billing_address,
    cust_shipping_address: data.sqt_shipping_address,
    so_payment_term: data.sqt_payment_term,
    so_delivery_method: data.sqt_delivery_method_id,
    delivery_method_text: data.delivery_method_text || "",

    cp_driver_name: data.cp_customer_pickup,
    cp_ic_no: data.cp_ic_no,
    cp_driver_contact_no: data.driver_contact_no,
    cp_vehicle_number: data.vehicle_number,
    cp_pickup_date: data.pickup_date,
    validity_of_collection: data.validity_of_collection,

    cs_courier_company: data.courier_company,
    cs_shipping_date: data.shipping_date,
    cs_tracking_number: data.cs_tracking_number,
    est_arrival_date: data.cs_est_arrival_date,
    cs_freight_charges: data.freight_charges,

    ct_driver_name: data.ct_driver_name,
    ct_ic_no: data.ct_ic_no,
    ct_driver_contact_no: data.ct_driver_contact_no,
    ct_delivery_cost: data.ct_delivery_cost,
    ct_vehicle_number: data.ct_vehicle_number,
    ct_est_delivery_date: data.ct_est_delivery_date,

    ss_shipping_company: data.ss_shipping_company,
    ss_shippping_date: data.ss_shipping_date,
    ss_freight_charges: data.ss_freight_charges,
    ss_shipping_method: data.ss_shipping_method,
    ss_est_arrival_date: data.est_arrival_date,
    ss_tracking_number: data.ss_tracking_number,

    tpt_vehicle_number: data.tpt_vehicle_number,
    tpt_transport_name: data.tpt_transport_name,
    tpt_ic_no: data.tpt_ic_no,
    tpt_driver_contact_no: data.tpt_driver_contact_no,

    table_so: soLineItemPromises,
    so_total_gross: data.sqt_sub_total,
    so_total_discount: data.sqt_total_discount,
    so_total_tax: data.sqt_total_tax,
    so_total: data.sqt_totalsum,
    exchange_rate: data.exchange_rate,
    so_remarks: data.sqt_remarks,
    myr_total_amount: data.myr_total_amount,

    billing_address_line_1: data.billing_address_line_1,
    billing_address_line_2: data.billing_address_line_2,
    billing_address_line_3: data.billing_address_line_3,
    billing_address_line_4: data.billing_address_line_4,
    billing_address_city: data.billing_address_city,
    billing_postal_code: data.billing_postal_code,
    billing_address_state: data.billing_address_state,
    billing_address_country: data.billing_address_country,
    billing_address_name: data.billing_address_name,
    billing_address_phone: data.billing_address_phone,
    billing_attention: data.billing_attention,

    shipping_address_line_1: data.shipping_address_line_1,
    shipping_address_line_2: data.shipping_address_line_2,
    shipping_address_line_3: data.shipping_address_line_3,
    shipping_address_line_4: data.shipping_address_line_4,
    shipping_address_city: data.shipping_address_city,
    shipping_postal_code: data.shipping_postal_code,
    shipping_address_state: data.shipping_address_state,
    shipping_address_country: data.shipping_address_country,
    shipping_address_name: data.shipping_address_name,
    shipping_address_phone: data.shipping_address_phone,
    shipping_attention: data.shipping_attention,
    so_shipping_date: data.expected_shipment_date,
    so_remarks2: data.sqt_remarks2,
    so_remarks3: data.sqt_remarks3,
    partially_delivered: `0 / ${lineItemLength}`,
    fully_delivered: `0 / ${lineItemLength}`,
    access_group: data.access_group,
  };
};

(async () => {
  try {
    const unCompletedListID = "custom_kviatmto";
    const allListID = "custom_851imkgn";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted"
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      selectedRecords = selectedRecords.filter(
        (item) =>
          item.sqt_status === "Issued" || item.sqt_status === "Completed"
      );

      if (selectedRecords.length === 0) {
        await this.$alert(
          "No selected records are available for conversion. Please select records with status 'Issued' or 'Completed'.",
          "No Records to Convert",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "warning",
          }
        );
        return;
      }

      // Filter out records that are not "Issued"
      await this.$confirm(
        `Only these quotation records available for conversion. Proceed?<br><br>
        <strong>Selected Records:</strong><br> ${selectedRecords
          .map((item) => item.sqt_no)
          .join("<br>")}`,
        "Confirm Conversion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      // Process multiple selections
      if (selectedRecords.length > 1) {
        console.log("this.$confirm", this.$confirm);
        await this.$confirm(
          `You have selected ${selectedRecords.length} quotation records. Would you like to convert these into a single sales order or into multiple sales orders?<br><br>
          <strong>Single SO:</strong> All items combined into one document<br>
          <strong>Multiple SOs:</strong> Separate orders for better tracking`,
          "Quotation Conversion",
          {
            confirmButtonText: "Single SO",
            cancelButtonText: "Multiple SOs",
            dangerouslyUseHTMLString: true,
            type: "info",
            distinguishCancelAndClose: true,

            beforeClose: async (action, instance, done) => {
              if (action === "confirm") {
                await handleSingleSO(selectedRecords);
                await this.getComponent(
                  activeTab === "Uncompleted" ? unCompletedListID : allListID
                )?.$refs.crud.clearSelection();
                done();
              } else if (action === "cancel") {
                await handleMultipleSO(selectedRecords);
                await this.getComponent(
                  activeTab === "Uncompleted" ? unCompletedListID : allListID
                )?.$refs.crud.clearSelection();
                done();
              } else {
                done();
              }
            },
          }
        );
      } else if (selectedRecords.length === 1) {
        await handleSingleSO(selectedRecords);
      }

      await this.getComponent(
        activeTab === "Uncompleted" ? unCompletedListID : allListID
      )?.$refs.crud.clearSelection();
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
