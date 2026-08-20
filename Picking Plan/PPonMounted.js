// A subform row is identified by its fm_key, not by where it sits: the platform
// resolves `table_to.<fm_key>.<field>` to that row. Positions are the wrong
// handle for a row -- and a bundle's items have no position of their own at
// all, being rows of the tree rather than of table_to -- so every row below is
// addressed by key. The position is kept only as a fallback for a row that has
// not been given a key yet.
const rowPathOf = (row, fallback) =>
  row && row.fm_key ? `table_to.${row.fm_key}` : fallback;

// Every row of the document -- top-level rows and the items under a bundle --
// each with the path that addresses it.
const rowsWithPaths = (rows) =>
  (rows || []).flatMap((row, index) => {
    const path = rowPathOf(row, `table_to.${index}`);
    const bundleChildren = Array.isArray(row.children) ? row.children : [];

    return [
      { row, path },
      ...bundleChildren.map((child, childIndex) => ({
        row: child,
        path: rowPathOf(child, `${path}.children.${childIndex}`),
      })),
    ];
  });

// Helper functions
const showStatusHTML = (status) => {
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
    case "Cancelled":
      this.display(["cancel_status"]);
      break;
    default:
      break;
  }
};

const disabledField = async (status, pickingStatus) => {
  if (status === "Completed") {
    this.disabled(
      [
        "to_status",
        "so_id",
        "so_no",
        "fake_so_id",
        "to_billing_name",
        "to_billing_cp",
        "to_billing_address",
        "to_shipping_address",
        "to_no",
        "to_ref_doc",
        "customer_name",
        "document_description",
        "plant_id",
        "organization_id",
        "to_delivery_method",
        "driver_name",
        "driver_contact_no",
        "validity_of_collection",
        "vehicle_no",
        "pickup_date",
        "courier_company",
        "shipping_date",
        "freight_charges",
        "tracking_number",
        "est_arrival_date",
        "driver_cost",
        "est_delivery_date",
        "shipping_company",
        "shipping_method",
        "order_remark",
        "to_item_balance.table_item_balance",
      ],
      true,
    );

    // Disable table rows
    disableTableRows();

    // Hide buttons and links
    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_created",
    ]);

    if (status === "Completed") {
      this.hide(["button_save_as_completed"]);
    }
  } else {
    if (status === "Created") {
      this.hide(["button_save_as_draft"]);

      if (pickingStatus === "In Progress" || pickingStatus === "Completed") {
        this.hide(["button_save_as_created"]);
      }

      this.disabled(["plant_id"], true);
    }
    this.disabled(
      [
        "to_ref_doc",
        "to_delivery_method",
        "document_description",
        "order_remark",
      ],
      false,
    );
  }
};

const disableTableRows = () => {
  setTimeout(() => {
    const data = this.getValues();

    // Walks a bundle's items in alongside the top-level rows; without them they
    // stay editable on a document that is meant to be read-only.
    rowsWithPaths(data.table_to).forEach(({ row, path }) => {
      const fieldNames = Object.keys(row).filter(
        (key) => key !== "to_delivery_qty",
      );

      const fieldsToDisable = fieldNames.map((field) => `${path}.${field}`);

      this.disabled(fieldsToDisable, true);
    });
  }, 1000);
};

const displayDeliveryMethod = async () => {
  const deliveryMethodName = this.getValue("to_delivery_method");
  console.log("deliveryMethodName", deliveryMethodName);

  if (
    deliveryMethodName &&
    typeof deliveryMethodName === "string" &&
    deliveryMethodName.trim() !== ""
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
        if (field === selectedField) {
          this.display(field);
        } else {
          this.hide(field);
        }
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

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";
  const hasPlant = this.getValue("plant_id");

  if (!hasPlant) {
    if (deptId === organizationId) {
      const resPlant = await db
        .collection("blade_dept")
        .where({ parent_id: deptId })
        .get();

      if (!resPlant || resPlant.data.length === 0) {
        plantId = deptId;
      } else {
        plantId = "";
        this.disabled("table_to", true);
      }
    } else {
      plantId = deptId;
    }
  }

  this.setData({
    organization_id: organizationId,
    ...(!hasPlant ? { plant_id: plantId } : {}),
    to_created_by: this.getVarGlobal("nickname"),
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

const disabledSelectStock = async (data) => {
  // A bundle row has no material of its own, so the guard below already steps
  // over it. Its items take the same treatment as any other row.
  //
  // Every row used to fetch its own item and its own balance, which on a plan of
  // any size is dozens of round trips -- and because those fetches sat inside a
  // forEach they also resolved AFTER disabledBundleRows had run, quietly handing
  // an item under a bundle back its editable quantity. Everything is fetched up
  // front instead, so the whole pass is awaited and the bundle lock keeps the
  // last word.
  const rows = rowsWithPaths(data.table_to).filter(
    ({ row }) => row.material_id && row.material_id !== "",
  );

  if (rows.length === 0) return;

  const plant = data.plant_id;
  const materialIds = [...new Set(rows.map(({ row }) => row.material_id))];

  const inFilter = (extra) => [
    {
      type: "branch",
      operator: "all",
      children: [
        { prop: "material_id", operator: "in", value: materialIds },
        ...extra,
      ],
    },
  ];

  const resItem = await db
    .collection("Item")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          { prop: "id", operator: "in", value: materialIds },
          { prop: "is_deleted", operator: "equal", value: 0 },
        ],
      },
    ])
    .get();

  const itemMap = new Map((resItem?.data || []).map((item) => [item.id, item]));

  // How many balance rows each material has. Only "exactly one" matters below:
  // a single balance leaves nothing to choose between, so the row is planned by
  // quantity rather than through the stock dialog.
  const countByMaterial = async (collection, extra) => {
    const counts = new Map();
    if (!plant) return counts;

    const res = await db.collection(collection).filter(inFilter(extra)).get();

    (res?.data || []).forEach((balance) => {
      const key = balance.material_id;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return counts;
  };

  const plainCounts = await countByMaterial("item_balance", [
    { prop: "plant_id", operator: "equal", value: plant },
    { prop: "is_deleted", operator: "equal", value: 0 },
  ]);
  const batchCounts = await countByMaterial("item_batch_balance", [
    { prop: "plant_id", operator: "equal", value: plant },
  ]);

  // The one thing both branches did, however picking_status stood: hand the row
  // its quantity field and take away the stock dialog.
  const planByQuantity = (index) => {
    this.disabled([`${index}.to_delivery_qty`], true);
    this.disabled([`${index}.to_qty`], false);
  };

  rows.forEach(({ row: item, path: index }) => {
    const itemData = itemMap.get(item.material_id);
    if (!itemData) return;

    if (itemData.stock_control === 0 && itemData.show_delivery === 0) {
      planByQuantity(index);
    }

    if (itemData.item_batch_management === 0) {
      if (plainCounts.get(item.material_id) === 1) {
        planByQuantity(index);
      }
    } else if (itemData.item_batch_management === 1) {
      if (batchCounts.get(item.material_id) === 1) {
        planByQuantity(index);
      }
    } else {
      console.error("Item batch management is not found.");
    }
  });
};

// A bundle row is not an item: its quantity is the number of bundles and stays
// editable -- changing it spreads across the items by ratio, which is why their
// own quantity fields are locked in turn. This runs after disabledSelectStock
// so it has the last word on the rows it owns.
//
// "Select Plan Qty" is not locked here. It is a link column and does not take a
// row index, so an imperative call cannot single out the bundle row -- it is
// disabled by the column's own per-row expression instead.
const disabledBundleRows = async (data) => {
  const rows = data.table_to || [];

  rows.forEach((row, index) => {
    const bundleChildren = Array.isArray(row.children) ? row.children : [];
    const isBundleParentRow = Boolean(row.item_bundle_id) && !row.material_id;

    if (!isBundleParentRow) return;

    const path = rowPathOf(row, `table_to.${index}`);

    this.disabled([`${path}.to_qty`], false);

    bundleChildren.forEach((child, childIndex) => {
      const childPath = rowPathOf(child, `${path}.children.${childIndex}`);

      this.disabled([`${childPath}.to_qty`], true);
    });

    console.log(
      "item bundle row",
      row.item_bundle_id,
      "locked with",
      bundleChildren.length,
      "items",
    );
  });
};

const setDisplayAssignedTo = async (data) => {
  const pickingSetupResponse = await db
    .collection("picking_setup")
    .where({
      plant_id: data.plant_id,
      picking_after: "Sales Order",
      picking_required: 1,
    })
    .get();

  if (pickingSetupResponse.data.length > 0) {
    this.display("assigned_to");
  }
};
const fetchDeliveredQuantity = async () => {
  const tableGD = this.getValue("table_to") || [];

  // An item under a bundle is a line of the sales order in its own right and
  // moves against it like any other, so it needs refreshing too -- it is just
  // not a row of table_to. One query covers the whole tree instead of one per
  // row. The bundle row itself is skipped: its sales order line is a header
  // that never carries a delivered quantity.
  const isBundleParent = (row) =>
    Boolean(row.item_bundle_id) && !row.material_id;

  const soLineIds = [
    ...new Set(
      rowsWithPaths(tableGD)
        .filter(({ row }) => !isBundleParent(row) && row.so_line_item_id)
        .map(({ row }) => row.so_line_item_id),
    ),
  ];

  if (soLineIds.length === 0) return;

  const resSOLineData = await db
    .collection("sales_order_axszx8cj_sub")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [{ prop: "id", operator: "in", value: soLineIds }],
      },
    ])
    .get();

  const soLineById = new Map(
    (resSOLineData?.data || []).map((line) => [line.id, line]),
  );

  const refresh = (item) => {
    if (isBundleParent(item)) return item;

    const soLine = soLineById.get(item.so_line_item_id);
    const totalDeliveredQuantity = soLine ? soLine.delivered_qty || 0 : 0;
    const orderQty = soLine ? soLine.so_quantity || 0 : 0;
    const maxDeliverableQty =
      Math.round((orderQty - totalDeliveredQuantity) * 1000) / 1000;

    return {
      ...item,
      to_undelivered_qty:
        Math.round((maxDeliverableQty - item.to_qty) * 1000) / 1000,
      to_initial_delivered_qty: totalDeliveredQuantity,
    };
  };

  const updatedTableGD = tableGD.map((item) => ({
    ...refresh(item),
    ...(Array.isArray(item.children) && {
      children: item.children.map(refresh),
    }),
  }));

  this.setData({ table_to: updatedTableGD });
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";
    const status = await this.getValue("to_status");
    const pickingStatus = await this.getValue("picking_status");
    const data = this.getValues();

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });

    const salesOrderId = this.getValue("so_id");

    switch (pageStatus) {
      case "Add":
        // Add mode
        this.display(["draft_status"]);

        await checkAccIntegrationType(organizationId);
        await setPlant(organizationId);
        await displayDeliveryMethod();
        if (salesOrderId.length > 0) {
          await this.display(["address_grid"]);
        }

        let allItems = this.getParamsVariables("allItems") || "";
        if (allItems && allItems !== "") {
          allItems = JSON.parse(allItems);
          await this.triggerEvent("func_processGDLineItem", {
            allItems,
          });
        }
        break;

      case "Edit":
        console.log("Full data", data);
        const fromConvert = this.getValue("from_convert");
        if (fromConvert === "Yes") {
          let allItem = this.getValue("all_item");
          if (allItem !== "") {
            allItem = JSON.parse(allItem);
            await this.triggerEvent("func_processGDLineItem", {
              allItems: allItem,
            });
          }
        }
        if (status !== "Completed") {
          await disabledSelectStock(data);
          await disabledBundleRows(data);
          await setDisplayAssignedTo(data);
        }
        await checkAccIntegrationType(organizationId);
        await disabledField(status, pickingStatus);
        await showStatusHTML(status);
        if (salesOrderId.length > 0) {
          await this.display(["address_grid"]);
        }
        await displayDeliveryMethod();
        await fetchDeliveredQuantity();
        break;

      case "View":
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await setDisplayAssignedTo(data);
        this.hide([
          "link_billing_address",
          "link_shipping_address",
          "button_save_as_draft",
          "button_save_as_completed",
          "button_save_as_created",
          "so_id",
          "fake_so_id",
        ]);

        if (salesOrderId.length > 0) {
          await this.display(["address_grid"]);
        }

        this.display(["so_no"]);
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
    const op = await this.onDropdownVisible("to_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("to_no");
  const { options } = params;

  const optionsData = this.getOptionData("to_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("to_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        to_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ to_no_type: defaultData.value });
    }
  }
}, 200);
