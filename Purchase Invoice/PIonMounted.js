const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Fully Posted":
      this.display(["fullyposted_status"]);
      break;
  }
};

const isViewMode = async () => {
  this.hide([
    "link_billing_address",
    "link_shipping_address",
    "button_save_as_draft",
    "button_completed",
    "button_posted",
    "button_completed_posted",
  ]);
};

const displayCurrency = async (status) => {
  const currencyCode = this.getValue("currency_code");

  if (currencyCode !== "----" && currencyCode !== "MYR") {
    this.display([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);
    if (status !== "Draft") {
      this.disabled("exchange_rate", true);
    }
  }

  this.setData({
    total_gross_currency: currencyCode,
    total_discount_currency: currencyCode,
    total_tax_currency: currencyCode,
    total_amount_currency: currencyCode,
    exchange_rate_currency: currencyCode,
  });
};

const displayAddress = async () => {
  const supplierName = this.getValue("supplier_name");

  if (supplierName) {
    this.display("address_grid");
  }
};

const disabledEditField = async (status) => {
  if (status !== "Draft") {
    this.disabled(
      [
        "pi_status",
        "currency_code",
        "organization_id",
        "plant_id",
        "supplier_name",
        "pi_billing_name",
        "pi_billing_cp",
        "pi_billing_address",
        "pi_shipping_address",
        "agent_id",
        "gr_no_display",
        "po_no_display",
        "purchase_invoice_no",
        "invoice_date",
        "inv_tax_rate_id",
        "inv_taxes_rate_percent",
        "invoice_payment_term_id",
        "exchange_rate",
        "textarea_msaqd5qk",
        "table_pi",
        "invoice_subtotal",
        "invoice_total_discount",
        "invoice_taxes_amount",
        "invoice_total",
        "remarks",
        "remarks2",
        "remarks3",
        "pi_ref_doc",
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
        "pi_description",
      ],
      true
    );
    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_issue",
      "button_completed",
      "button_completed_posted",
    ]);

    if (status === "Completed") {
      this.display("button_posted");
    } else {
      this.hide("button_posted");
    }
  } else {
    this.disabled(
      [
        "agent_id",
        "purchase_invoice_no",
        "invoice_date",
        "invoice_payment_term_id",
        "pi_description",
        "remarks",
        "remarks2",
        "remarks3",
        "pi_ref_doc",
      ],
      false
    );
    this.hide(["button_posted"]);
  }
};

const displayTax = async () => {
  const totalTax = this.getValue("invoice_taxes_amount");

  if (totalTax > 0.0) {
    this.display(["invoice_taxes_amount", "total_tax_currency"]);
  }
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";

  if (deptId === organizationId) {
    const resPlant = await db
      .collection("blade_dept")
      .where({ parent_id: deptId })
      .get();

    if (!resPlant && resPlant.data.length === 0) {
      plantId = deptId;
    } else {
      plantId = "";
    }
  } else {
    plantId = deptId;
  }

  this.setData({
    organization_id: organizationId,
    plant_id: plantId,
    invoice_date: new Date().toISOString().split("T")[0],
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

      if (aiData.acc_integration_type === "No Accounting Integration") {
        this.hide(["button_posted", "button_completed_posted"]);
      }
    }
  }
};

const displayGRNumber = async () => {
  const grNo = this.getValue("gr_no_display");

  this.display("po_no_display");

  if (grNo && grNo !== "") {
    this.display(["gr_no_display", `table_pi.goods_receiving_no`]);
  } else {
    this.hide(["gr_no_display", `table_pi.goods_receiving_no`]);
  }
};

(async () => {
  try {
    const status = await this.getValue("pi_status");

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
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });
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
        this.hide("button_posted");
        this.disabled("table_pi", true);
        await setPlant(organizationId);
        await checkAccIntegrationType(organizationId);
        break;

      case "Edit":
        await disabledEditField(status);
        await checkAccIntegrationType(organizationId);
        await showStatusHTML(status);
        await displayCurrency(status);
        await displayAddress();
        await displayTax();
        await displayGRNumber();
        break;

      case "View":
        await showStatusHTML(status);
        await isViewMode();
        await displayCurrency(status);
        await displayAddress();
        await displayTax();
        await displayGRNumber();

        break;
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
