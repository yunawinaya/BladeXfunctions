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
  if (status === "Completed") {
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
        "so_no",
        "tpt_vehicle_number",
        "tpt_transport_name",
        "tpt_ic_no",
        "tpt_driver_contact_no",
      ],
      true,
    );

    this.hide([
      "button_save_as_draft",
      "button_save_as_issue",
      "link_billing_address",
      "link_shipping_address",
    ]);
  } else if (status === "Issued" || status === "Processing") {
    this.hide("button_save_as_draft");
    this.disabled(["so_type", "auto_si", "auto_gd"], true);
  }
};

// For a SO auto-created from an internal-trading PO (source_po_id set), lock
// everything that comes from the PO and leave ONLY the line-level discount + tax
// fields editable, so the seller org can apply its own discount/tax.
const disableLinkedSOFields = async () => {
  // Lock all header fields (do NOT hide save buttons — discount/tax stay savable).
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
      "so_sales_person",
      "so_total_gross",
      "so_total_discount",
      "so_total_tax",
      "so_total",
      "so_remarks",
      "so_remarks2",
      "so_remarks3",
      "cust_po",
      "cust_po_date",
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
      "tpt_vehicle_number",
      "tpt_transport_name",
      "tpt_ic_no",
      "tpt_driver_contact_no",
    ],
    true,
  );

  // Lock every editable line column EXCEPT discount + tax.
  const tableSO = this.getValue("table_so") || [];
  const lineColsToDisable = [
    "item_name",
    "item_id",
    "so_desc",
    "more_desc",
    "so_quantity",
    "so_item_uom",
    "so_item_price",
    "so_gross",
    "so_amount",
    "so_brand",
    "so_packaging_style",
    "line_remark_1",
    "line_remark_2",
    "line_remark_3",
    "packing_uom",
    "packing_qty",
    "packing_no",
    "hu_no",
    "net_weight",
    "weight_conversion",
  ];
  const lineColsToKeep = [
    "so_discount",
    "so_discount_amount",
    "so_discount_uom",
    "so_tax_preference",
    "so_tax_percentage",
    "so_tax_amount",
    "so_tax_inclusive",
  ];
  tableSO.forEach((_, index) => {
    this.disabled(
      lineColsToDisable.map((c) => `table_so.${index}.${c}`),
      true,
    );
    // Ensure discount + tax stay editable regardless of status-based locking.
    this.disabled(
      lineColsToKeep.map((c) => `table_so.${index}.${c}`),
      false,
    );
  });
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
    } else {
      fields.forEach((field) => {
        field === selectedField ? this.display(field) : this.hide(field);
      });
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
  console.log("component", this.getComponent("table_so"));
  tableSO.forEach((so, rowIndex) => {
    if (
      so.line_status === "Processing" ||
      so.line_status === "Completed" ||
      so.planned_qty > 0 ||
      so.delivered_qty > 0
    ) {
      this.disabled(`table_so.${rowIndex}`, true);
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
    so.outstanding_quantity = 0;
    so.posted_qty = 0;
    so.production_qty = 0;
    so.production_status = "";
    so.si_status = "";
    so.line_status = "";
  }

  this.setData({
    gd_status: "",
    to_status: "",
    production_status: "",
    si_posted_status: "",
    si_status: "",
    sr_status: "",
    srr_status: "",
    so_no: "",
    sqt_no: "",
    sqt_id: [],
    posted_status: "",
    previous_status: "",
    table_so: tableSO,
    create_si: "No",
    partially_delivered: `0 / ${tableSO.length}`,
    fully_delivered: `0 / ${tableSO.length}`,
    cust_po: "",
    cust_po_date: null,
    source_po_id: "",
  });
};

const setPlant = (organizationId, pageStatus) => {
  console.log("1111");
  const currentDept = (this.getVarSystem("deptIds") || "").split(",")[0] || "";
  console.log("2222");
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
    (conv) => conv.alt_uom_id === baseUOM,
  );

  if (!uomConversion || !uomConversion.base_qty) {
    return baseQty;
  }

  return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
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
              0,
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
              0,
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
              0,
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
            so.so_item_uom,
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
      organizationId = (this.getVarSystem("deptIds") || "").split(",")[0] || "";
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
        await setPlant(organizationId, pageStatus);
        this.setData({
          created_source: "Web",
          so_date: new Date().toISOString().split("T")[0],
          so_created_by: this.getVarGlobal("nickname"),
          ...(this.getParamsVariables("sales_order_title") === "Sales Invoice"
            ? { so_type: "Credit", auto_si: 1 }
            : this.getParamsVariables("sales_order_title") === "Cash Sales"
              ? { so_type: "Cash", auto_si: 1 }
              : { so_type: "Credit" }),
          create_si: "No",
        });
        if (this.getValue("so_no")) {
          this.display("so_no");
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
        //await fetchUnrestrictedQty();
        break;

      case "Edit":
        await setPlant(organizationId, pageStatus);
        if (this.getValue("so_no")) {
          this.display("so_no");
        }

        this.setData({ previous_status: status });
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
          // A PO-linked SO: lock everything except line discount + tax.
          if (this.getValue("source_po_id") && status !== "Completed") {
            await disableLinkedSOFields();
          }
        }, 50);

        //await fetchUnrestrictedQty();
        break;

      case "Clone":
        this.display(["draft_status"]);
        this.setData({
          created_source: "Web",
          so_date: new Date().toISOString().split("T")[0],
          so_no: null,
          so_status: null,
          gd_status: null,
          so_type: "Credit",
          auto_si: 0,
          auto_gd: 0,
          create_si: "No",
        });
        await setPlant(organizationId, pageStatus);
        if (this.getValue("so_no")) {
          this.display("so_no");
        }
        await cloneResetQuantity();
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
        if (this.getValue("so_no")) {
          this.display("so_no");
        }
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

setTimeout(async () => {
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("so_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("so_no");
  const { options } = params;

  const optionsData = this.getOptionData("so_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("so_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        so_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ so_no_type: defaultData.value });
    }
  }
}, 200);
