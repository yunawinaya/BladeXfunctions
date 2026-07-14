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

const displayCurrency = async () => {
  const currencyCode = this.getValue("currency_code");

  this.setData({
    total_gross_currency: currencyCode,
    total_discount_currency: currencyCode,
    total_tax_currency: currencyCode,
    total_amount_currency: currencyCode,
    exchange_rate_currency: currencyCode,
  });
};

const displaySOAddress = async () => {
  const salesOrderId = this.getValue("so_id");

  if (salesOrderId.length > 0) {
    this.display("address_grid");
  }
};

const disabledField = async (status) => {
  if (status !== "Draft") {
    this.disabled(
      [
        "si_status",
        "si_address_name",
        "si_address_contact",
        "sales_invoice_no",
        "sales_invoice_date",
        "sales_person_id",
        "si_payment_term_id",
        "si_description",
        "posted_date",
        "posted_status",
        "plant_id",
        "invoice_type",
        "organization_id",
        "fileupload_hmtcurne",
        "invoice_subtotal",
        "invoice_total_discount",
        "invoice_taxes_amount",
        "invoice_total",
        "tnc",
        "payment_term",
        "delivery_term",
        "remarks",
        "remarks2",
        "remarks3",
        "remarks4",
        "remarks5",
        "si_billing_address",
        "si_shipping_address",
        "gd_no_display",
        "so_no_display",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "billing_address_city",
        "billing_address_state",
        "billing_postal_code",
        "billing_address_country",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "shipping_address_city",
        "shipping_address_state",
        "shipping_postal_code",
        "shipping_address_country",
        "exchange_rate",
        "myr_total_amount",
        "si_ref_doc",
      ],
      true,
    );
  } else {
    this.disabled(
      [
        "sales_person_id",
        "sales_invoice_date",
        "si_payment_term_id",
        "si_description",
        "remarks",
        "si_ref_doc",
      ],
      false,
    );
  }
};

const displayGDNumber = async () => {
  const gdNo = this.getValue("gd_no_display");

  this.display("so_no_display");

  if (gdNo && gdNo !== "") {
    this.display(["gd_no_display", `table_si.line_gd_no`]);
  } else {
    this.hide(["gd_no_display", `table_si.line_gd_no`]);
  }
};

const isViewMode = async (status) => {
  if (status === "Completed") {
    this.hide([
      "link_shipping_address",
      "link_billing_address",
      "button_save_as_draft",
      "button_completed",
      "button_posted",
      "button_completed_posted",
    ]);
  } else {
    this.hide([
      "link_shipping_address",
      "link_billing_address",
      "button_save_as_draft",
      "button_completed",
      "button_posted",
      "button_completed_posted",
      "button_update_completed",
      "button_update_posted",
    ]);
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
      this.disabled("table_si", true);
    }
  } else {
    plantId = deptId;
  }

  this.setData({
    organization_id: organizationId,
    plant_id: plantId,
    sales_invoice_date: new Date().toISOString().split("T")[0],
    si_description: "Sales",
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
        this.hide([
          "button_posted",
          "button_completed_posted",
          "button_update_completed",
          "button_update_posted",
        ]);
      }
    }
  }
};

(async () => {
  try {
    const status = await this.getValue("si_status");

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
        this.hide([
          "button_posted",
          "button_update_completed",
          "button_update_posted",
        ]);
        this.setData({
          created_source: "Web",
        });
        await setPlant(organizationId);
        await checkAccIntegrationType(organizationId);

        break;

      case "Edit":
        await checkAccIntegrationType(organizationId);
        await showStatusHTML(status);
        await displayCurrency();
        await displaySOAddress();
        await displayTax();
        await displayGDNumber();
        await disabledField(status);
        console.log("status", status);
        this.setData({ previous_status: status });
        console.log("data", this.getValues());

        if (status === "Draft") {
          this.hide([
            "button_posted",
            "button_update_completed",
            "button_update_posted",
          ]);
        } else if (status === "Completed") {
          this.hide([
            "link_shipping_address",
            "link_billing_address",
            "button_save_as_draft",
            "button_completed",
            "button_completed_posted",
          ]);
          this.display([
            "button_posted",
            "button_update_completed",
            "button_update_posted",
          ]);

          this.disabled("table_si.invoice_qty", true);

          setTimeout(() => {
            document
              .querySelectorAll(
                "#pane-tab_si button.el-button--danger.el-button--small",
              )
              .forEach((button) => {
                button.disabled = true;
                button.setAttribute("aria-disabled", "true");
              });
          }, 100);
        }

        break;

      case "View":
        this.disabled("sales_invoice_date", false);
        await showStatusHTML(status);
        await displayGDNumber();
        await displayCurrency();
        await displaySOAddress();
        await isViewMode(status);
        await displayTax();

        break;
    }
  } catch (error) {
    this.$message.error(error);
  }
})();

setTimeout(async () => {
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("sales_invoice_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("sales_invoice_no");
  const { options } = params;

  const optionsData = this.getOptionData("sales_invoice_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("sales_invoice_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        sales_invoice_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ sales_invoice_no_type: defaultData.value });
    }
  }
}, 200);
