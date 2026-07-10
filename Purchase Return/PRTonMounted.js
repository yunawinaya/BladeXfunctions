const setPlant = async (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds");

  if (currentDept === organizationId) {
    this.disabled("plant", false);
    this.disabled("table_prt", true);
  } else {
    if (pageStatus === "Add") {
      setTimeout(() => {
        this.setData({
          plant: currentDept,
        });
      }, 50);
    }
    this.disabled("plant", true);
  }
};

const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    // Legacy: purchase returns saved before the Created/Completed split.
    case "Issued":
      this.display(["issued_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
  }
};

const displayDeliveryMethod = async () => {
  const deliveryMethod = this.getValue("return_delivery_method");

  if (deliveryMethod && Object.keys(deliveryMethod).length > 0) {
    this.setData({ delivery_method_text: deliveryMethod });

    const visibilityMap = {
      "Self Pickup": "self_pickup",
      "Courier Service": "courier_service",
      "Company Truck": "company_truck",
      "Shipping Service": "shipping_service",
      "3rd Party Transporter": "third_party_transporter",
    };

    const selectedField = visibilityMap[deliveryMethod] || null;
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
    fields.forEach((field) => {
      field === selectedField ? this.display(field) : this.hide(field);
    });
  } else {
    this.setData({ delivery_method_text: "" });
  }
};

const displayAddress = async () => {
  const grID = this.getValue("gr_id");

  if (grID) {
    this.display("address_grid");
  }
};

const disabledField = async (status) => {
  if (status === "Draft") return;

  // Created: the return quantity is reserved against the GR/PO lines but no
  // stock has moved yet, so the document can still be corrected or completed.
  // Only the identity fields are frozen.
  if (status === "Created") {
    this.disabled(
      [
        "purchase_return_status",
        "purchase_return_no",
        "organization_id",
        "supplier_id",
        "plant",
      ],
      true,
    );

    this.hide(["button_save_as_draft"]);
    this.display(["button_save_as_created", "button_save_as_completed"]);
    return;
  }

  // Completed / Cancelled (and legacy Issued): fully read-only.
  this.disabled(
    [
      "purchase_return_status",
      "purchase_return_no",
      "organization_id",
      "supplier_id",
      "prt_billing_name",
      "prt_billing_cp",
      "prt_billing_address",
      "prt_shipping_address",
      "gr_date",
      "plant",
      "purchase_return_date",
      "input_hvxpruem",
      "return_delivery_method",
      "purchase_return_ref",
      "shipping_details",
      "reason_for_return",

      "driver_name",
      "vehicle_no",
      "cp_ic_no",
      "driver_contact",
      "pickup_date",

      "courier_company",
      "shipping_date",
      "estimated_arrival",
      "shipping_method",
      "freight_charge",

      "driver_name2",
      "ct_ic_no",
      "driver_contact_no2",
      "estimated_arrival2",
      "vehicle_no2",
      "delivery_cost",

      "tpt_vehicle_number",
      "tpt_transport_name",
      "tpt_ic_no",
      "tpt_driver_contact_no",

      "table_prt.return_condition",
      "confirm_inventory.table_item_balance",

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
    ],
    true,
  );

  this.hide([
    "link_billing_address",
    "link_shipping_address",
    "button_save_as_draft",
    "button_save_as_created",
    "button_save_as_completed",
  ]);
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

(async () => {
  try {
    const status = await this.getValue("purchase_return_status");

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

    this.setData({ organization_id: organizationId, page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        await setPlant(organizationId, pageStatus);
        await checkAccIntegrationType(organizationId);
        await this.setData({ return_by: this.getVarGlobal("nickname") });
        break;

      // A clone is a brand new draft. Without clearing the number and status it
      // inherits the source document's purchase_return_no — the workflow only
      // regenerates when the number is blank or the previous status was Draft —
      // and would save under a duplicate number.
      // Deliberately no setPlant() here: it disables table_prt at parent-org level,
      // and processData() (which re-enables the per-row inputs) never runs on a
      // clone, so the cloned lines would be uneditable.
      case "Clone":
        this.display(["draft_status"]);
        this.setData({
          purchase_return_no: null,
          purchase_return_status: null,
          previous_status: null,
          return_by: this.getVarGlobal("nickname"),
        });
        await checkAccIntegrationType(organizationId);
        await displayDeliveryMethod();
        await displayAddress();
        break;

      case "Edit":
        this.setData({ previous_status: status });
        await disabledField(status);
        await checkAccIntegrationType(organizationId);
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await displayAddress();
        break;

      case "View":
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await displayAddress();
        this.hide([
          "link_billing_address",
          "link_shipping_address",
          "button_save_as_draft",
          "button_save_as_created",
          "button_save_as_completed",
        ]);

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
    const op = await this.onDropdownVisible("purchase_return_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("purchase_return_no");
  const { options } = params;

  const optionsData = this.getOptionData("purchase_return_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("purchase_return_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        purchase_return_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ purchase_return_no_type: defaultData.value });
    }
  }
}, 200);
