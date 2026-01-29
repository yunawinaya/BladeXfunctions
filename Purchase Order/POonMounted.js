const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Issued":
      this.display(["issued_status"]);
      break;
    case "Processing":
      this.display(["processing_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
    default:
      break;
  }
};

const displayFields = async () => {
  const poDeliveryAddress = this.getValue("po_delivery_address");
  const preqNo = this.getValue("preq_no");
  const totalTax = this.getValue("po_total_tax");

  if (totalTax > 0) {
    this.display(["po_total_tax", "total_tax_currency"]);
  }

  if (poDeliveryAddress === "Supplier") {
    this.display("po_receiving_supplier");
    this.hide("po_plant");
  }

  if (preqNo) {
    this.display("preq_no");
  }
};

const displayCurrency = async () => {
  const currencyCode = this.getValue("po_currency");

  if (currencyCode && currencyCode !== "----" && currencyCode !== "MYR") {
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

const displayPlantAddress = async () => {
  const plant = this.getValue("po_plant");

  if (plant) {
    this.display("address_grid");
  }
};

const displayTax = async () => {
  const totalTax = this.getValue("po_total_tax");

  if (totalTax > 0.0) {
    this.display(["po_total_tax", "total_tax_currency"]);
  }
};

const enabledUOMField = async () => {
  const tablePO = this.getValue("table_po");

  tablePO.forEach((po, rowIndex) => {
    if (po.item_id || po.item_desc !== "") {
      this.triggerEvent("LineItem_onChange_fillback", {
        poItem: po,
        index: rowIndex,
      });
      this.disabled([`table_po.${rowIndex}.quantity_uom`], false);
    }

    if (po.tax_percent || po.tax_percent >= 0) {
      this.disabled([`table_po.${rowIndex}.tax_percent`], false);
    }
  });
};

const disabledEditField = async (status) => {
  if (status !== "Draft" && status !== "Issued") {
    this.disabled(
      [
        "purchase_order_no",
        "po_supplier_id",
        "organization_id",
        "po_date",
        "po_currency",
        "po_delivery_address",
        "po_plant",
        "po_receiving_supplier",
        "po_billing_name",
        "po_billing_cp",
        "po_billing_address",
        "po_shipping_address",
        "po_payment_terms",
        "po_expected_date",
        "po_shipping_preference",
        "po_ref_doc",
        "table_po",
        "po_total_gross",
        "po_total_discount",
        "po_total_tax",
        "po_total",
        "po_remark",
        "po_remark2",
        "po_remark3",
        "po_tnc",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "billing_address_city",
        "billing_postal_code",
        "billing_address_state",
        "billing_address_country",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "shipping_address_city",
        "shipping_postal_code",
        "shipping_address_state",
        "shipping_address_country",
        "exchange_rate",
        "myr_total_amount",
      ],
      true
    );

    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_issue",
    ]);
  } else if (status === "Issued") {
    this.hide("button_save_as_draft");
  }
};

const cloneResetQuantity = async (data) => {
  const tablePO = this.getValue("table_po");

  for (const po of tablePO) {
    po.received_qty = 0;
    po.created_received_qty = 0;
    po.return_quantity = 0;
    po.invoice_qty = 0;
    po.posted_qty = 0;
    po.min_price = 0;
    po.max_price = 0;
    po.outstanding_quantity = 0;
    po.preq_id = "";
    po.line_status = "";
    po.pi_status = "";
  }

  data["table_po"] = tablePO;
  data["gr_status"] = "";
  data["pi_posted_status"] = "";
  data["pi_status"] = "";
  data["return_status"] = "";
  data["partially_received"] = `0 / ${tablePO.length}`;
  data["fully_received"] = `0 / ${tablePO.length}`;
  data["po_date"] = new Date().toISOString().split("T")[0];
  data["po_status"] = "Draft";
  data["preq_no"] = "";
  data["preq_id"] = [];
  data["purchase_order_no"] = null;

  this.hide("preq_no");

  return data;
};

const setPlant = async (organizationId, pageStatus, data) => {
  const currentDept = this.getVarSystem("deptIds");

  if (currentDept === organizationId) {
    this.disabled("po_plant", false);

    if (pageStatus === "Add" || pageStatus === "Clone") {
      data["po_plant"] = currentDept;
    }
  } else {
    if (pageStatus === "Add" || pageStatus === "Clone") {
      data["po_plant"] = currentDept;
    }
    this.disabled("po_plant", true);
  }

  return data;
};

const checkAccIntegrationType = async (organizationId, data) => {
  if (organizationId) {
    const resAI = await db
      .collection("accounting_integration")
      .where({ organization_id: organizationId })
      .get();

    if (resAI && resAI.data.length > 0) {
      const aiData = resAI.data[0];
      data["acc_integration_type"] = aiData.acc_integration_type;
    }
  }

  return data;
};

(async () => {
  try {
    const status = await this.getValue("po_status");
    const data = {};
    const pageStatus = this.isAdd
      ? "Add"
      : this.isEdit
      ? "Edit"
      : this.isView
      ? "View"
      : this.isCopy
      ? "Clone"
      : (() => {
          this.$message.error("Invalid page status");
        })();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds");
    }
    data["page_status"] = pageStatus;
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
        data["organization_id"] = organizationId;
        data["po_date"] = new Date().toISOString().split("T")[0];

        await setPlant(organizationId, pageStatus, data);
        await checkAccIntegrationType(organizationId, data);
        await enabledUOMField();
        await displayFields();
        await displayCurrency();
        await displayPlantAddress();
        await displayTax();
        break;

      case "Edit":
        await disabledEditField(status);
        await showStatusHTML(status);
        await checkAccIntegrationType(organizationId, data);
        await enabledUOMField();
        await displayFields();
        await displayCurrency();
        await displayPlantAddress();
        await displayTax();
        await setPlant(organizationId, pageStatus, data);
        data["previous_status"] = this.getValue("po_status");
        this.disabled(
          status !== "Draft"
            ? ["purchase_order_no", "purchase_order_no_type"]
            : [],
          true
        );
        break;

      case "Clone":
        await displayFields();
        await checkAccIntegrationType(organizationId, data);
        await setPlant(organizationId, pageStatus, data);
        await enabledUOMField();
        await displayCurrency();
        await displayPlantAddress();
        await displayTax();
        await showStatusHTML("Draft");
        await cloneResetQuantity(data);

        break;

      case "View":
        this.hide([
          "link_billing_address",
          "link_shipping_address",
          "button_save_as_draft",
          "button_save_as_issue",
        ]);
        await showStatusHTML(status);
        await displayFields();
        await displayCurrency();
        await displayPlantAddress();
        await displayTax();

        break;
    }

    this.setData(data);
  } catch (error) {
    this.$message.error(error);
  }
})();

setTimeout(async () => {
  if (this.isAdd) {
    const op = await this.onDropdownVisible("purchase_order_no_type", true);
    function getDefaultItem(arr) {
      return arr?.find((item) => item?.item?.item?.is_default === 1);
    }
    setTimeout(() => {
      const optionsData = this.getOptionData("purchase_order_no_type") || [];
      const data = getDefaultItem(optionsData);
      if (data) {
        this.setData({
          purchase_order_no_type: data.value,
        });
      }
    }, 500);
  }
}, 500);
