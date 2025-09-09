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
  this.hide([
    "link_billing_address",
    "link_shipping_address",
    "button_save_as_draft",
    "button_save_as_comp",
    "button_completed",
  ]);
};

const disabledEditField = async (status) => {
  if (status !== "Draft") {
    this.disabled(
      [
        "gr_status",
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
      "button_completed",
    ]);

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
  }
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";

  if (deptId === organizationId) {
    plantId = "";
    this.disabled(["table_gr"], true);
  } else {
    plantId = deptId;
  }

  this.setData({
    organization_id: organizationId,
    plant_id: plantId,
    gr_received_by: this.getVarGlobal("nickname"),
  });
};

const fetchReceivedQuantity = async () => {
  const tableGR = this.getValue("table_gr") || [];

  const resPOLineData = await Promise.all(
    tableGR.map((item) =>
      db
        .collection("purchase_order_2ukyuanr_sub")
        .doc(item.po_line_item_id)
        .get()
    )
  );

  const poLineItemData = resPOLineData.map((response) => response.data[0]);

  const updatedTableGR = tableGR.map((item, index) => {
    const poLine = poLineItemData[index];
    const totalReceivedQty = poLine ? poLine.received_qty || 0 : 0;
    const orderQty = poLine ? poLine.quantity || 0 : 0;
    const maxReceivableQty = orderQty - totalReceivedQty;
    return {
      ...item,
      to_received_qty: maxReceivableQty,
    };
  });

  this.setData({ table_gr: updatedTableGR });
};

const viewSerialNumber = async () => {
  const tableGR = this.getValue("table_gr");
  tableGR.forEach((gr, index) => {
    if (gr.is_serialized_item === 1) {
      this.display(`table_gr.select_serial_number`);
      this.disabled(`table_gr.${index}.received_qty`, true);
    } else {
      this.disabled(`table_gr.${index}.received_qty`, false);
    }
  });
};

const viewBaseQty = async () => {
  const tableGR = this.getValue("table_gr");
  tableGR.forEach((gr) => {
    if (gr.item_uom !== gr.base_item_uom) {
      this.display([
        "table_gr.ordered_qty_uom",
        "table_gr.base_ordered_qty",
        "table_gr.base_ordered_qty_uom",
        "table_gr.to_received_qty_uom",
        "table_gr.base_received_qty_uom",
        "table_gr.base_received_qty",
        "table_gr.base_item_uom",
      ]);
    }
  });
};

const displayAssignedTo = async () => {
  const plant = await this.getValue("plant_id");

  const resPutAwaySetup = await db
    .collection("putaway_setup")
    .where({
      plant_id: plant,
      is_deleted: 0,
      movement_type: "Good Receiving",
    })
    .get();

  if (resPutAwaySetup && resPutAwaySetup.data.length > 0) {
    this.display("assigned_to");
  } else {
    this.hide("assigned_to");
  }
};

const hideSerialNumberRecordTab = () => {
  setTimeout(() => {
    const tableSerialNumber = this.getValue("table_sn_records");
    if (!tableSerialNumber || tableSerialNumber.length === 0) {
      const tabSelector =
        '.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-serial_number_records[tabindex="-1"][aria-selected="false"]';
      const tab = document.querySelector(tabSelector);

      if (tab) {
        tab.style.display = "none";
      } else {
        const fallbackTab = document.querySelector(
          '.el-drawer[role="dialog"] .el-tabs__item#tab-serial_number_records'
        );
        if (fallbackTab) {
          fallbackTab.style.display = "none";
        } else {
          console.log("Completion tab not found");
        }
      }

      const inactiveTabSelector =
        '.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-serial_number_records)';
      const inactiveTab = document.querySelector(inactiveTabSelector);
      if (inactiveTab) {
        inactiveTab.setAttribute("aria-disabled", "true");
        inactiveTab.classList.add("is-disabled");
      }
    }
  }, 10); // Small delay to ensure DOM is ready
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
        await hideSerialNumberRecordTab();

        break;

      case "Edit":
        await getPrefixData(organizationId);
        await disabledEditField(status);
        await displayAddress();
        await showStatusHTML(status);
        await fetchReceivedQuantity();
        await viewSerialNumber();
        await viewBaseQty();
        await displayAssignedTo();
        await hideSerialNumberRecordTab();
        if (status === "Draft") {
          this.triggerEvent("onChange_plant");
          this.hide("button_completed");
        } else {
          this.disabled("assigned_to", true);
        }
        break;

      case "View":
        await displayAddress();
        await showStatusHTML(status);
        await isViewMode();
        await viewBaseQty();
        await displayAssignedTo();
        await hideSerialNumberRecordTab();
        break;
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
