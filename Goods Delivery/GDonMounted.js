// Helper functions
const generatePrefix = (prefixData) => {
  const now = new Date();
  let prefixToShow = prefixData.current_prefix_config;

  prefixToShow = prefixToShow.replace("prefix", prefixData.prefix_value);
  prefixToShow = prefixToShow.replace("suffix", prefixData.suffix_value);
  prefixToShow = prefixToShow.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0"),
  );
  prefixToShow = prefixToShow.replace(
    "day",
    String(now.getDate()).padStart(2, "0"),
  );
  prefixToShow = prefixToShow.replace("year", now.getFullYear());
  prefixToShow = prefixToShow.replace(
    "running_number",
    String(prefixData.running_number).padStart(prefixData.padding_zeroes, "0"),
  );

  return prefixToShow;
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("goods_delivery")
    .where({ delivery_no: generatedPrefix, organization_id: organizationId })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix({
      ...prefixData,
      running_number: runningNumber,
    });
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Goods Delivery number after maximum attempts",
    );
  }

  return { prefixToShow, runningNumber };
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Delivery",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();

  if (!prefixEntry.data || prefixEntry.data.length === 0) {
    return null;
  } else {
    if (prefixEntry.data[0].is_active === 0) {
      this.disabled(["delivery_no"], false);
    } else {
      this.disabled(["delivery_no"], true);
    }
  }

  return prefixEntry.data[0];
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  if (prefixData && prefixData.is_active === 1) {
    const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);
    this.setData({ delivery_no: prefixToShow });
  }
};

const showStatusHTML = (status) => {
  console.log("status", status);
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
        "gd_status",
        "so_id",
        "so_no",
        "fake_so_id",
        "gd_billing_name",
        "gd_billing_cp",
        "gd_billing_address",
        "gd_shipping_address",
        "delivery_no",
        "gd_ref_doc",
        "customer_name",
        "gd_contact_name",
        "contact_number",
        "email_address",
        "document_description",
        "plant_id",
        "organization_id",
        "gd_delivery_method",
        "delivery_date",
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
        "gd_item_balance.table_item_balance",
        "select_vehicle_id",
        "select_driver_id",
        "order_tnc",
        "order_payment_details",
        "order_delivery_term",
        "order_remark",
        "order_remark2",
        "order_remark3",
        "order_remark4",
        "order_remark5",
      ],
      true,
    );

    // Disable table rows
    await disableTableRows();

    // Hide buttons and links
    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_created",
      "button_save_as_completed",
    ]);
  } else {
    if (status === "Created") {
      this.hide(["button_save_as_draft"]);

      if (pickingStatus === "In Progress" || pickingStatus === "Completed") {
        this.hide(["button_save_as_created"]);
      }
    }
    this.disabled(
      [
        "gd_ref_doc",
        "gd_delivery_method",
        "document_description",
        "order_remark",
        "select_vehicle_id",
        "select_driver_id",
      ],
      false,
    );
  }
};

const disableTableRows = async () => {
  return new Promise((resolve) => {
    setTimeout(async () => {
      try {
        const data = await this.getValues();
        const rows = data.table_gd || [];

        rows.forEach((row, index) => {
          const fieldNames = Object.keys(row).filter(
            (key) => key !== "gd_delivery_qty",
          );

          const fieldsToDisable = fieldNames.map(
            (field) => `table_gd.${index}.${field}`,
          );

          this.disabled(fieldsToDisable, true);
        });
        resolve();
      } catch (error) {
        console.error("Error disabling table rows:", error);
        resolve();
      }
    }, 1000);
  });
};

const displayDeliveryMethod = async () => {
  const deliveryMethodName = this.getValue("gd_delivery_method");
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
        this.disabled("table_gd", true);
      }
    } else {
      plantId = deptId;
    }
  }

  this.setData({
    organization_id: organizationId,
    ...(!hasPlant ? { plant_id: plantId } : {}),
    delivery_date: new Date().toISOString().replace("T", " "),
    gd_created_by: this.getVarGlobal("nickname"),
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
  const tableGD = data.table_gd || [];

  for (let index = 0; index < tableGD.length; index++) {
    const item = tableGD[index];

    if (item.material_id && item.material_id !== "") {
      try {
        const resItem = await db
          .collection("Item")
          .where({ id: item.material_id, is_deleted: 0 })
          .get();

        if (resItem && resItem.data.length > 0) {
          const plant = data.plant_id;
          const itemData = resItem.data[0];

          if (itemData.stock_control === 0 && itemData.show_delivery === 0) {
            this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
            this.disabled([`table_gd.${index}.gd_qty`], false);
            continue;
          }

          if (itemData.item_batch_management === 0) {
            if (plant) {
              const resItemBalance = await db
                .collection("item_balance")
                .where({
                  plant_id: plant,
                  material_id: item.material_id,
                  is_deleted: 0,
                })
                .get();

              if (resItemBalance && resItemBalance.data.length === 1) {
                this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
                this.disabled([`table_gd.${index}.gd_qty`], false);
              }
            }
          } else if (itemData.item_batch_management === 1) {
            const resItemBatchBalance = await db
              .collection("item_batch_balance")
              .where({ material_id: item.material_id, plant_id: plant })
              .get();

            if (resItemBatchBalance && resItemBatchBalance.data.length === 1) {
              this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
              this.disabled([`table_gd.${index}.gd_qty`], false);
            }
          } else {
            console.error(
              `Item batch management is not found for item: ${item.material_id}`,
            );
          }
        }
      } catch (error) {
        console.error(
          `Error processing item ${item.material_id} at index ${index}:`,
          error,
        );
      }
    }
  }
};

const setPickingSetup = async (data) => {
  const pickingSetupResponse = await db
    .collection("picking_setup")
    .where({
      plant_id: data.plant_id,
      picking_required: 1,
    })
    .get();

  if (pickingSetupResponse.data.length > 0) {
    if (pickingSetupResponse.data[0].picking_after === "Goods Delivery") {
      this.display("assigned_to");
    } else if (pickingSetupResponse.data[0].picking_after === "Sales Order") {
      this.setData({ is_select_picking: 1 });
      this.display("pp_no");
      this.hide("button_save_as_created");
    }
  }
};

const fetchDeliveredQuantity = async () => {
  try {
    const tableGD = this.getValue("table_gd") || [];

    if (tableGD.length === 0) {
      return;
    }

    const resSOLineData = await Promise.all(
      tableGD.map((item) =>
        item.so_line_item_id
          ? db
              .collection("sales_order_axszx8cj_sub")
              .doc(item.so_line_item_id)
              .get()
              .catch((error) => {
                console.error(
                  `Error fetching SO line item ${item.so_line_item_id}:`,
                  error,
                );
                return { data: [null] };
              })
          : Promise.resolve({ data: [null] }),
      ),
    );

    const soLineItemData = resSOLineData.map((response) =>
      response.data ? response.data[0] : null,
    );

    const updatedTableGD = tableGD.map((item, index) => {
      const soLine = soLineItemData[index];
      const totalDeliveredQuantity = soLine ? soLine.delivered_qty || 0 : 0;
      const orderQty = soLine ? soLine.so_quantity || 0 : 0;
      const maxDeliverableQty = orderQty - totalDeliveredQuantity;
      return {
        ...item,
        gd_undelivered_qty: maxDeliverableQty - item.gd_qty,
        gd_initial_delivered_qty: totalDeliveredQuantity,
      };
    });

    this.setData({ table_gd: updatedTableGD });
  } catch (error) {
    console.error("Error fetching delivered quantity:", error);
  }
};

const displayPlanQty = async (data) => {
  const tableGD = data.table_gd || [];

  for (const item of tableGD) {
    if (item.is_force_complete === 1) {
      this.display(["table_gd.plan_qty"]);
    }
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";
    const status = await this.getValue("gd_status");
    const pickingStatus = await this.getValue("picking_status");
    const data = this.getValues();

    console.log("Debug", data);

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
        // Set prefix for new document
        await setPrefix(organizationId);
        await displayDeliveryMethod();
        if (salesOrderId.length > 0) {
          await this.display(["address_grid"]);
        }

        let allItems = this.getParamsVariables("allItems") || "";
        if (allItems && allItems !== "") {
          console.log("all item mounted", allItems);
          allItems = JSON.parse(allItems);
          console.log("all item mounted json", allItems);
          allItems = allItems.map((item) => ({
            ...item,
            altUOM: item.altUOM.toString(),
          }));
          console.log("all item mounted convert", allItems);
          await this.triggerEvent("func_processGDLineItem", {
            allItems: allItems,
          });
        }
        break;

      case "Edit":
        console.log("Full data", data);
        const fromConvert = this.getValue("from_convert");
        if (fromConvert === "Yes") {
          let allItem = this.getValue("all_item");
          if (allItem !== "") {
            console.log("all item mounted", allItem);
            allItem = JSON.parse(allItem);
            console.log("all item mounted json", allItem);
            allItem = allItem.map((item) => ({
              ...item,
              altUOM: item.altUOM.toString(),
            }));
            console.log("all item mounted convert", allItem);
            await this.triggerEvent("func_processGDLineItem", {
              allItems: allItem,
            });
          }
        }
        if (status !== "Completed") {
          await getPrefixData(organizationId);
          await disabledSelectStock(data);
          await setPickingSetup(data);
        }
        await checkAccIntegrationType(organizationId);
        await disabledField(status, pickingStatus);
        await showStatusHTML(status);
        if (salesOrderId.length > 0) {
          await this.display(["address_grid"]);
        }
        await displayDeliveryMethod();
        await fetchDeliveredQuantity();
        await displayPlanQty(data);
        break;

      case "View":
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await setPickingSetup(data);
        await displayPlanQty(data);
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
