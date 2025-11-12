const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Issued":
      this.display(["issued_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Processing":
      this.display(["processing_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
    default:
      break;
  }
};

const displayCurrency = async () => {
  const currencyCode = this.getValue("so_currency");
  console.log("currencyCode", currencyCode);
  if (
    currencyCode !== "----" &&
    currencyCode !== "MYR" &&
    currencyCode !== "" &&
    currencyCode
  ) {
    this.display([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);
  }

  this.setData({
    total_gross_currency: currencyCode,
    total_discount_currency: currencyCode,
    total_tax_currency: currencyCode,
    total_amount_currency: currencyCode,
    exchange_rate_currency: currencyCode,
  });
};

const disabledField = async (status) => {
  if (status !== "Draft" && status !== "Issued") {
    this.disabled(
      [
        "so_status",
        "so_no",
        "so_date",
        "customer_name",
        "so_currency",
        "plant_name",
        "organization_id",
        "partially_delivered",
        "fully_delivered",
        "cust_billing_name",
        "cust_cp",
        "cust_billing_address",
        "cust_shipping_address",
        "so_payment_term",
        "so_delivery_method",
        "so_shipping_date",
        "so_ref_doc",
        "cp_driver_name",
        "cp_driver_contact_no",
        "cp_vehicle_number",
        "cp_pickup_date",
        "cp_ic_no",
        "validity_of_collection",
        "cs_courier_company",
        "cs_shipping_date",
        "est_arrival_date",
        "cs_tracking_number",
        "ct_driver_name",
        "ct_driver_contact_no",
        "ct_delivery_cost",
        "ct_vehicle_number",
        "ct_est_delivery_date",
        "ct_ic_no",
        "ss_shipping_company",
        "ss_shipping_date",
        "ss_freight_charges",
        "ss_shipping_method",
        "ss_est_arrival_date",
        "ss_tracking_number",
        "table_so",
        "so_sales_person",
        "so_total_gross",
        "so_total_discount",
        "so_total_tax",
        "so_total",
        "so_remarks",
        "so_remarks2",
        "so_remarks3",
        "cust_po",
        "so_tnc",
        "so_payment_details",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "billing_address_city",
        "billing_address_state",
        "billing_address_country",
        "billing_postal_code",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "shipping_address_city",
        "shipping_address_state",
        "shipping_address_country",
        "shipping_postal_code",
        "exchange_rate",
        "myr_total_amount",
        "sqt_no",
        "tpt_vehicle_number",
        "tpt_transport_name",
        "tpt_ic_no",
        "tpt_driver_contact_no",
      ],
      true
    );

    this.hide([
      "button_save_as_draft",
      "button_save_as_issue",
      "link_billing_address",
      "link_shipping_address",
    ]);
  } else if (status === "Issued") {
    this.hide("button_save_as_draft");
  }
};

const displayDeliveryMethod = async () => {
  const deliveryMethodName = this.getValue("so_delivery_method");
  console.log("deliveryMethodName", deliveryMethodName);

  if (
    deliveryMethodName &&
    typeof deliveryMethodName === "string" &&
    deliveryMethodName.trim() !== "" &&
    deliveryMethodName !== "{}"
  ) {
    this.setData({ delivery_method_text: deliveryMethodName });

    const visibilityMap = {
      "Self Pickup": "self_pickup",
      "Courier Service": "courier_service",
      "Company Truck": "company_truck",
      "Shipping Service": "shipping_service",
      "3rd Party Transporter": "third_party_transporter",
    };

    const selectedField = visibilityMap[deliveryMethodName] || null;
    const fields = [
      "self_pickup",
      "courier_service",
      "company_truck",
      "shipping_service",
      "third_party_transporter",
    ];

    if (!selectedField) {
      this.hide(fields);
    }
  } else {
    this.setData({ delivery_method_text: "" });

    const fields = [
      "self_pickup",
      "courier_service",
      "company_truck",
      "shipping_service",
      "third_party_transporter",
    ];
    this.hide(fields);
  }
};

const displayTax = async () => {
  const totalTax = this.getValue("so_total_tax");

  if (totalTax > 0.0) {
    this.display(["so_total_tax", "total_tax_currency"]);
  }
};

const enabledUOMField = async () => {
  const tableSO = this.getValue("table_so");
  console.log("enabledUOMField", tableSO);

  tableSO.forEach((so, rowIndex) => {
    if (so.item_name || so.so_desc !== "") {
      this.triggerEvent("onChange_item", { soItem: so, index: rowIndex });
      this.disabled([`table_so.${rowIndex}.so_item_uom`], false);
    }
  });
};

const checkAccIntegrationType = async (organizationId) => {
  if (organizationId) {
    const resAI = await db
      .collection("accounting_integration")
      .where({ organization_id: organizationId })
      .get();

    if (resAI && resAI.data.length > 0) {
      const aiData = resAI.data[0];

      this.setData({ acc_integration_type: aiData.acc_integration_type });
    }
  }
};

const cloneResetQuantity = async () => {
  const tableSO = this.getValue("table_so");

  for (const so of tableSO) {
    so.delivered_qty = 0;
    so.planned_qty = 0;
    so.return_qty = 0;
    so.invoice_qty = 0;
    so.posted_qty = 0;
    so.production_qty = 0;
    so.production_status = "";
  }

  this.setData({
    gd_status: "",
    to_status: "",
    production_status: "",
    si_posted_status: "",
    si_status: "",
    sr_status: "",
    srr_status: "",
    table_so: tableSO,
    partially_delivered: `0 / ${tableSO.length}`,
    fully_delivered: `0 / ${tableSO.length}`,
  });
};

const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];

  if (currentDept === organizationId) {
    this.disabled("plant_name", false);

    if (pageStatus === "Add" || pageStatus === "Clone") {
      this.setData({ plant_name: currentDept });
    }
  } else {
    this.disabled("plant_name", true);

    if (pageStatus === "Add" || pageStatus === "Clone") {
      this.setData({ plant_name: currentDept });
    }
  }
};

const convertBaseToAlt = (baseQty, uomConversionTable, baseUOM) => {
  if (
    !Array.isArray(uomConversionTable) ||
    uomConversionTable.length === 0 ||
    !baseUOM
  ) {
    return baseQty;
  }

  const uomConversion = uomConversionTable.find(
    (conv) => conv.alt_uom_id === baseUOM
  );

  if (!uomConversion || !uomConversion.alt_qty) {
    return baseQty;
  }

  return Math.round(baseQty * uomConversion.alt_qty * 1000) / 1000;
};

const fetchUnrestrictedQty = async () => {
  try {
    console.log("fetchUnrestrictedQty");
    const tableSO = this.getValue("table_so");
    const plantId = this.getValue("plant_name");
    const organizationId = this.getValue("organization_id");

    console.log("tableSO", tableSO);

    if (tableSO.length > 0) {
      for (const [index, so] of tableSO.entries()) {
        const itemId = so.item_name;

        let totalUnrestrictedQtyBase = 0;

        let item_batch_management = 0;
        let serial_number_management = 0;
        let stock_control = 0;
        let tableUOMConversion = [];
        let baseUOM;

        await db
          .collection("Item")
          .where({ id: itemId })
          .get()
          .then((res) => {
            const itemData = res.data[0];
            item_batch_management = itemData.item_batch_management;
            serial_number_management = itemData.serial_number_management;
            stock_control = itemData.stock_control;
            tableUOMConversion = itemData.table_uom_conversion;
            baseUOM = itemData.based_uom;
          });

        if (serial_number_management === 1) {
          const resSerialBalance = await db
            .collection("item_serial_balance")
            .where({
              material_id: itemId,
              ...(plantId !== organizationId
                ? { plant_id: plantId || null }
                : {}),
              organization_id: organizationId,
            })
            .get();

          if (resSerialBalance && resSerialBalance.data.length > 0) {
            const serialBalanceData = resSerialBalance.data;

            totalUnrestrictedQtyBase = serialBalanceData.reduce(
              (sum, balance) => sum + (balance.unrestricted_qty || 0),
              0
            );
          }
        } else if (
          (serial_number_management !== 1 || !serial_number_management) &&
          item_batch_management === 1 &&
          (stock_control !== 0 || stock_control)
        ) {
          const resBatchBalance = await db
            .collection("item_batch_balance")
            .where({
              material_id: itemId,
              ...(plantId !== organizationId
                ? { plant_id: plantId || null }
                : {}),
              organization_id: organizationId,
            })
            .get();

          if (resBatchBalance && resBatchBalance.data.length > 0) {
            const batchBalanceData = resBatchBalance.data;

            totalUnrestrictedQtyBase = batchBalanceData.reduce(
              (sum, balance) => sum + (balance.unrestricted_qty || 0),
              0
            );
          }
        } else if (
          (serial_number_management !== 1 || !serial_number_management) &&
          (item_batch_management !== 1 || !item_batch_management) &&
          (stock_control !== 0 || stock_control)
        ) {
          const resBalance = await db
            .collection("item_balance")
            .where({
              material_id: itemId,
              ...(plantId !== organizationId
                ? { plant_id: plantId || null }
                : {}),
              organization_id: organizationId,
            })
            .get();

          if (resBalance && resBalance.data.length > 0) {
            const balanceData = resBalance.data;

            totalUnrestrictedQtyBase = balanceData.reduce(
              (sum, balance) => sum + (balance.unrestricted_qty || 0),
              0
            );
          }
        } else {
          totalUnrestrictedQtyBase = 0;
        }

        let finalQty = 0;

        if (so.so_item_uom !== baseUOM) {
          finalQty = await convertBaseToAlt(
            totalUnrestrictedQtyBase,
            tableUOMConversion,
            so.so_item_uom
          );
        }
        this.setData({
          [`table_so.${index}.unrestricted_qty`]: finalQty,
          [`table_so.${index}.base_unrestricted_qty`]: totalUnrestrictedQtyBase,
        });
      }
    }
  } catch (error) {
    console.error(error);
  }
};

const setDefaultDocNo = async (organizationID) => {
  const defaultDocFormatFilter = new Filter("all")
    .equal("organization_id", organizationID)
    .equal("document_types", "Sales Orders")
    .numberEqual("is_default", 1)
    .build();
  const resDefaultDocFormat = await db
    .collection("document_number")
    .filter(defaultDocFormatFilter)
    .get();

  if (resDefaultDocFormat && resDefaultDocFormat.data.length > 0) {
    this.setData({
      document_no_format: resDefaultDocFormat.data[0].id,
      so_no: "<<new>>",
    });
  }
};

(async () => {
  try {
    const status = await this.getValue("so_status");
    const soCustomer = this.getValue("customer_name");

    if (soCustomer && !Array.isArray(soCustomer)) {
      this.display("address_grid");
    }
    let pageStatus = "";

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ organization_id: organizationId, page_status: pageStatus });
    this.hide([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);

    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        await checkAccIntegrationType(organizationId);
        await setDefaultDocNo(organizationId);
        await setPlant(organizationId, pageStatus);
        this.setData({
          so_date: new Date().toISOString().split("T")[0],
          so_created_by: this.getVarGlobal("nickname"),
        });
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }

        const customerID = this.getValue("customer_name");

        if (customerID) {
          this.disabled("table_so", false);
          this.display("price_history");
        } else {
          this.disabled("table_so", true);
        }

        await displayCurrency();
        await displayTax();
        await displayDeliveryMethod();
        await enabledUOMField();
        //await fetchUnrestrictedQty();
        break;

      case "Edit":
        console.log("onmounted so", this.getValue("table_so"));
        await setPlant(organizationId, pageStatus);
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }

        if (status !== "Draft") {
          this.disabled(["so_no", "document_no_format"], true);
        }
        await checkAccIntegrationType(organizationId);
        await disabledField(status);
        await showStatusHTML(status);
        await displayCurrency();
        await displayTax();
        await displayDeliveryMethod();
        setTimeout(async () => {
          await enabledUOMField();
        }, 50);

        this.display("price_history");
        //await fetchUnrestrictedQty();
        break;

      case "Clone":
        this.display(["draft_status"]);
        this.setData({ so_date: new Date().toISOString().split("T")[0] });
        await setPlant(organizationId, pageStatus);
        await setDefaultDocNo(organizationId);
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }
        await enabledUOMField();
        await cloneResetQuantity(status);
        await checkAccIntegrationType(organizationId);
        await displayCurrency();
        await displayTax();
        await displayDeliveryMethod();

        this.display("price_history");
        //await fetchUnrestrictedQty();

        console.log("delivered quantity", this.getValue("partially_delivered"));
        break;

      case "View":
        this.hide([
          "button_save_as_draft",
          "button_save_as_issue",
          "link_billing_address",
          "link_shipping_address",
          "customer_name",
        ]);
        this.display(["customer_name"]);
        await displayCurrency();
        await displayTax();
        await showStatusHTML(status);
        await displayDeliveryMethod();
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
