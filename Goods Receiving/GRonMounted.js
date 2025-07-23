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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("goods_receiving")
    .where({ gr_no: generatedPrefix, organization_id: organizationId })
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
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Goods Receiving number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);

  this.setData({ gr_no: prefixToShow });
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Receiving",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();
  const prefixData = await prefixEntry.data[0];

  if (prefixData.is_active === 0) {
    this.disabled(["gr_no"], false);
  }

  return prefixData;
};

const displayAddress = async () => {
  const data = this.getValues();

  if (
    data.gr_billing_name ||
    data.gr_billing_cp ||
    data.gr_billing_address ||
    data.gr_shipping_address
  ) {
    this.display("address_grid");
  }
};

const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;

    case "Received":
      this.display(["received_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
  }
};

const isViewMode = async () => {
  const grType = this.getValue("gr_type");
  this.hide([
    "link_billing_address",
    "link_shipping_address",
    "button_save_as_draft",
    "button_save_as_comp",
    "button_completed",
    "purchase_order_id",
    "fake_purchase_order_id",
    "fake_item_id",
    "item_id",
  ]);

  this.display(["purchase_order_number"]);
  if (grType === "Item") this.display(["item_code"]);
};

const disabledEditField = async (status) => {
  if (status !== "Draft") {
    this.disabled(
      [
        "gr_status",
        "purchase_order_id",
        "fake_purchase_order_id",
        "organization_id",
        "purchase_order_number",
        "gr_billing_name",
        "gr_billing_cp",
        "gr_billing_address",
        "gr_shipping_address",
        "supplier_name",
        "supplier_contact_person",
        "supplier_contact_number",
        "supplier_email",
        "plant_id",
        "gr_no",
        "gr_received_by",
        "gr_date",
        "table_gr",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "billing_address_city",
        "shipping_address_city",
        "billing_postal_code",
        "shipping_postal_code",
        "billing_address_state",
        "shipping_address_state",
        "billing_address_country",
        "shipping_address_country",
        "reference_doc",
        "ref_no_1",
        "ref_no_2",
      ],
      true
    );

    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_comp",
      "purchase_order_id",
      "fake_purchase_order_id",
      "button_completed",
    ]);

    this.display(["purchase_order_number"]);

    if (status === "Received") {
      this.display(["button_completed"]);
    }
  } else {
    const data = this.getValues();
    data.table_gr.forEach(async (gr, index) => {
      if (gr.item_id) {
        if (
          !gr.item_batch_no &&
          gr.item_batch_no !== "Auto-generated batch number" &&
          gr.item_batch_no !== "-"
        ) {
          this.disabled([`table_gr.${index}.item_batch_no`], false);
        }
      }
    });
    this.disabled("reference_doc", false);
    this.hide("fake_purchase_order_id");
    this.display("purchase_order_id");
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
      this.disabled(["fake_purchase_order_id"], true);
    }
  } else {
    plantId = deptId;
  }

  this.setData({
    organization_id: organizationId,
    plant_id: plantId,
    gr_type: "Document",
    gr_received_by: this.getVarGlobal("nickname"),
  });
};

const displayGrType = async (status) => {
  const grType = this.getValue("gr_type");
  const supplierId = this.getValue("supplier_name");

  if (grType === "Document") {
    this.hide(["fake_item_id", "item_id"]);
    if (!supplierId && status !== "Received") {
      this.display("fake_purchase_order_id");
      this.disabled("fake_purchase_order_id", false);
      this.hide("purchase_order_id");
    } else if (supplierId && status !== "Received") {
      this.display("purchase_order_id");
      this.hide("fake_purchase_order_id");
    } else {
      this.hide(["fake_purchase_order_id", "purchase_order_id"]);
      this.display("purchase_order_number");
    }
  } else if (grType === "Item") {
    this.hide(["fake_purchase_order_id", "purchase_order_id"]);
    this.display(["purchase_order_number", "item_code"]);
    if (!supplierId && status !== "Received") {
      this.display("fake_item_id");
      this.hide("item_id");
    } else if (supplierId && status !== "Received") {
      this.display("item_id");
      this.hide("fake_item_id");
    } else {
      this.hide(["fake_item_id", "item_id"]);
      this.display(["purchase_order_number", "item_code"]);
    }
  }
};

(async () => {
  try {
    const status = await this.getValue("gr_status");

    const pageStatus = this.isAdd
      ? "Add"
      : this.isEdit
      ? "Edit"
      : this.isView
      ? "View"
      : (() => {
          throw new Error("Invalid page status");
        })();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        this.setData({ gr_date: new Date().toISOString().split("T")[0] });
        this.display(["draft_status"]);
        this.hide("button_completed");
        await setPlant(organizationId);
        await setPrefix(organizationId);

        break;

      case "Edit":
        await getPrefixData(organizationId);
        await disabledEditField(status);
        await displayAddress();
        await showStatusHTML(status);
        await displayGrType(status);

        if (status === "Draft") {
          this.disabled("gr_type", !this.getValue("plant_id"));
          this.hide("button_completed");
        }
        break;

      case "View":
        await displayAddress();
        await showStatusHTML(status);
        await isViewMode();
        break;
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
