// Helper functions
const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Issued":
      this.display(["issued_status"]);
      break;
    case "In Progress":
      this.display(["processing_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Fully Posted":
      this.display(["fullyposted_status"]);
      break;
    default:
      break;
  }
};

const checkPrefixConfiguration = async (movementType, organizationId) => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Stock Movement",
        movement_type: movementType,
        is_deleted: 0,
        organization_id: organizationId,
      })
      .get();

    if (prefixEntry.data && prefixEntry.data.length > 0) {
      return prefixEntry.data[0];
    }
    return null;
  } catch (error) {
    console.error("Error checking prefix configuration:", error);
    return null;
  }
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

const filterMovementType = async () => {
  const resDict = await db
    .collection("blade_dict")
    .where({ dict_value: "Stock Movement Type" })
    .get();

  if (resDict && resDict.data.length > 0) {
    const stockMovementId = resDict.data[0].id;

    const resMovementType = await db
      .collection("blade_dict")
      .where({ parent_id: stockMovementId })
      .get();

    if (resMovementType && resMovementType.data.length > 0) {
      const allMovementTypes = await resMovementType.data;
      const restrictedTypes = [
        "Good Issue",
        "Production Receipt",
        "Inter Operation Facility Transfer (Receiving)",
      ];

      const filteredTypes = allMovementTypes.filter(
        (type) => !restrictedTypes.includes(type.dict_value)
      );

      this.setOptionData(["movement_type"], filteredTypes);
    } else {
      console.error("No movement types found in database");
      return;
    }
  } else {
    console.error("No movement types found in database");
    return;
  }
};

const displayDeliveryField = async () => {
  const deliveryMethodName = this.getValue("delivery_method");
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

const filterIOFTReceivingCategory = async () => {
  const data = this.getValues();
  const stockMovement = data.stock_movement;

  const categoryObjectResponse = await db
    .collection("blade_dict")
    .where({ code: "inventory_category" })
    .get();

  const allowedCategories = ["Unrestricted", "Quality Inspection", "Blocked"];

  const filteredCategories = categoryObjectResponse.data.filter((category) =>
    allowedCategories.includes(category.dict_key)
  );

  console.log("filteredCategories", filteredCategories);

  // Set category options
  for (const [rowIndex, sm] of stockMovement.entries()) {
    await this.setOptionData(
      [`stock_movement.${rowIndex}.category`],
      filteredCategories
    );
  }
};

// Main execution function
(async () => {
  try {
    const data = this.getValues();
    let pageStatus = "";
    const status = await this.getValue("stock_movement_status");

    // Determine page status
    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Set page status in data
    this.setData({ page_status: pageStatus, organization_id: organizationId });

    // Get movement type
    let movementType = data.movement_type || "";

    let stockMovement = data.stock_movement || [];

    if (movementType) {
      await this.setData({ movement_type: undefined });
      await this.setData({ movement_type: movementType });
    }

    if (stockMovement) {
      await this.setData({ stock_movement: [] });
      await this.setData({ stock_movement: stockMovement });
    }

    if (pageStatus !== "Add") {
      // Handle Edit/View/Clone modes
      const stockMovementId = data.id;
      await checkAccIntegrationType(organizationId);
      await displayDeliveryField();
      const resSM = await db
        .collection("stock_movement")
        .where({ id: stockMovementId })
        .get();

      console.log("data JN", data);
      if (data.is_production_order === 1) {
        this.display(["production_order_id"]);
        this.disabled(
          ["stock_movement.item_selection", "stock_movement.location_id"],
          true
        );
      }

      const nickName = await this.getVarGlobal("nickname");
      this.setData({ issued_by: nickName });
      if (resSM.data && resSM.data.length > 0) {
        const stockMovement = resSM.data[0];
        const {
          stock_movement_status,
          issue_date,
          stock_movement_no,
          movement_type,
          movement_type_id,
          movement_reason,
          issued_by,
          issuing_operation_faci,
          remarks,
          delivery_method,
          reference_documents,
          receiving_operation_faci,
          movement_id,
          is_production_order,
          production_order_id,
          organization_id,

          cp_driver_name,
          cp_ic_no,
          cp_driver_contact_no,
          cp_vehicle_number,
          cp_pickup_date,
          cp_validity_collection,
          cs_courier_company,
          cs_shipping_date,
          cs_tracking_number,
          cs_est_arrival_date,
          cs_freight_charges,
          ct_driver_name,
          ct_driver_contact_no,
          ct_ic_no,
          ct_vehicle_number,
          ct_est_delivery_date,
          ct_delivery_cost,
          ss_shipping_company,
          ss_shipping_date,
          ss_freight_charges,
          ss_shipping_method,
          ss_est_arrival_date,
          ss_tracking_number,
          tpt_vehicle_number,
          tpt_transport_name,
          tpt_ic_no,
          tpt_driver_contact_no,

          stock_movement,
          balance_index,
        } = stockMovement;

        const data = {
          stock_movement_status,
          issue_date,
          stock_movement_no,
          movement_type,
          movement_type_id,
          movement_reason,
          issued_by,
          issuing_operation_faci,
          remarks,
          organization_id,
          delivery_method,
          reference_documents,
          receiving_operation_faci,
          movement_id,
          is_production_order,
          production_order_id,

          cp_driver_name,
          cp_ic_no,
          cp_driver_contact_no,
          cp_vehicle_number,
          cp_pickup_date,
          cp_validity_collection,
          cs_courier_company,
          cs_shipping_date,
          cs_tracking_number,
          cs_est_arrival_date,
          cs_freight_charges,
          ct_driver_name,
          ct_driver_contact_no,
          ct_ic_no,
          ct_vehicle_number,
          ct_est_delivery_date,
          ct_delivery_cost,
          ss_shipping_company,
          ss_shipping_date,
          ss_freight_charges,
          ss_shipping_method,
          ss_est_arrival_date,
          ss_tracking_number,
          tpt_vehicle_number,
          tpt_transport_name,
          tpt_ic_no,
          tpt_driver_contact_no,

          stock_movement,
          balance_index,
        };

        if (pageStatus === "Edit") {
          // Check if prefix is active for movement type
          const prefixConfig = await checkPrefixConfiguration(
            movementType,
            organizationId
          );

          if (prefixConfig && prefixConfig.is_active === 0) {
            this.disabled(["stock_movement_no"], false);
          }

          // Set data for edit mode
          await this.setData(data);
          await filterMovementType();

          // Show appropriate status UI
          showStatusHTML(stock_movement_status);

          // Edit mode: Disable and hide fields
          this.disabled(["movement_type"], true);
          this.hide([
            "stock_movement.transfer_stock",
            "stock_movement.view_stock",
          ]);

          if (
            status === "Created" &&
            movement_type === "Inter Operation Facility Transfer (Receiving)"
          ) {
            this.disabled(["stock_movement.received_quantity"], true);
            await filterIOFTReceivingCategory();
          }

          if (status === "Completed" || status === "Fully Posted") {
            this.disabled(
              [
                "issue_date",
                "stock_movement_no",
                "movement_type",
                "movement_reason",
                "issued_by",
                "issuing_operation_faci",
                "remarks",
                "delivery_method",
                "reference_documents",
                "receiving_operation_faci",
                "movement_id",
                "is_production_order",
                "production_order_id",

                "cp_driver_name",
                "cp_ic_no",
                "cp_driver_contact_no",
                "cp_vehicle_number",
                "cp_pickup_date",
                "cp_validity_collection",

                "cs_courier_company",
                "cs_shipping_date",
                "cs_tracking_number",
                "cs_est_arrival_date",
                "cs_freight_charges",

                "ct_driver_name",
                "ct_driver_contact_no",
                "ct_ic_no",
                "ct_vehicle_number",
                "ct_est_delivery_date",
                "ct_delivery_cost",

                "ss_shipping_company",
                "ss_shipping_date",
                "ss_freight_charges",
                "ss_shipping_method",
                "ss_est_arrival_date",
                "ss_tracking_number",

                "tpt_vehicle_number",
                "tpt_transport_name",
                "tpt_ic_no",
                "tpt_driver_contact_no",

                "stock_movement",
                "stock_movement.item_selection",
                "stock_movement.total_quantity",
                "stock_movement.category",
                "stock_movement.received_quantity",
                "stock_movement.received_quantity_uom",
                "stock_movement.unit_price",
                "stock_movement.amount",
                "stock_movement.location_id",
                "stock_movement.batch_id",
              ],
              true
            );

            // Hide edit button
            setTimeout(() => {
              const editButton = document.querySelector(
                ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--small.is-link"
              );
              if (editButton) {
                editButton.style.display = "none";
              }
            }, 500);

            this.hide([
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
            ]);

            if (
              movementType === "Miscellaneous Issue" ||
              movementType === "Miscellaneous Receipt" ||
              movementType === "Disposal/Scrap"
            ) {
              this.display("button_post");
            }
          }
        } else {
          // View mode or other
          // Keep original values
          data.stock_movement_status = stock_movement_status;
          data.stock_movement_no = stock_movement_no;
          await this.setData(data);

          // Show appropriate status UI
          showStatusHTML(stock_movement_status);

          // View mode: Disable and hide fields
          if (pageStatus === "View") {
            this.disabled(
              [
                "issue_date",
                "stock_movement_no",
                "movement_type",
                "movement_reason",
                "issued_by",
                "issuing_operation_faci",
                "remarks",
                "delivery_method",
                "reference_documents",
                "receiving_operation_faci",
                "movement_id",
                "is_production_order",
                "production_order_id",

                "cp_driver_name",
                "cp_ic_no",
                "cp_driver_contact_no",
                "cp_vehicle_number",
                "cp_pickup_date",
                "cp_validity_collection",

                "cs_courier_company",
                "cs_shipping_date",
                "cs_tracking_number",
                "cs_est_arrival_date",
                "cs_freight_charges",

                "ct_driver_name",
                "ct_driver_contact_no",
                "ct_ic_no",
                "ct_vehicle_number",
                "ct_est_delivery_date",
                "ct_delivery_cost",

                "ss_shipping_company",
                "ss_shipping_date",
                "ss_freight_charges",
                "ss_shipping_method",
                "ss_est_arrival_date",
                "ss_tracking_number",

                "tpt_vehicle_number",
                "tpt_transport_name",
                "tpt_ic_no",
                "tpt_driver_contact_no",

                "stock_movement.item_selection",
                "stock_movement.total_quantity",
                "stock_movement.category",
                "stock_movement.received_quantity",
                "stock_movement.received_quantity_uom",
                "stock_movement.unit_price",
                "stock_movement.amount",
                "stock_movement.location_id",
                "stock_movement.batch_id",
              ],
              true
            );

            // Hide edit button
            setTimeout(() => {
              const editButton = document.querySelector(
                ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--small.is-link"
              );
              if (editButton) {
                editButton.style.display = "none";
              }
            }, 500);

            this.hide([
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
              "stock_movement.view_stock",
            ]);
          }
        }
      }
    } else {
      const nickName = await this.getVarGlobal("nickname");
      await checkAccIntegrationType(organizationId);
      await filterMovementType();
      this.setData({
        issued_by: nickName,
        issue_date: new Date().toISOString().split("T")[0],
      });
      this.disabled(["stock_movement"], true);
      this.display(["draft_status", "button_save_as_draft"]);
      this.hide([
        "delivery_method",
        "receiving_operation_faci",
        "stock_movement.view_stock",
        "stock_movement.edit_stock",
      ]);
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
