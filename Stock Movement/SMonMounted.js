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

// Main execution function
(async () => {
  try {
    const data = this.getValues();
    let pageStatus = "";

    // Determine page status
    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    // Set page status in data
    this.setData({ page_status: pageStatus });

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Get movement type
    let movementType = data.movement_type || "";

    if (movementType) {
      console.log("movementType", movementType);
      console.log("Triggering JN");
      this.setData({ movement_type: undefined });
      this.setData({ movement_type: movementType });
    }

    if (pageStatus !== "Add") {
      // Handle Edit/View/Clone modes
      const stockMovementId = data.id;

      const resSM = await db
        .collection("stock_movement")
        .where({ id: stockMovementId })
        .get();

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
          driver_name,
          driver_contact_no,
          vehicle_no,
          pickup_date,
          courier_company,
          shipping_date,
          freight_charges,
          tracking_number,
          est_arrival_date,
          delivery_cost,
          est_delivery_date,
          organization_id,
          shipping_company,
          date_qn0dl3t6,
          input_77h4nsq8,
          shipping_method,
          tracking_no,
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
          driver_name,
          driver_contact_no,
          vehicle_no,
          pickup_date,
          courier_company,
          shipping_date,
          freight_charges,
          tracking_number,
          est_arrival_date,
          delivery_cost,
          est_delivery_date,
          shipping_company,
          date_qn0dl3t6,
          input_77h4nsq8,
          shipping_method,
          tracking_no,
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

          // Show appropriate status UI
          showStatusHTML(stock_movement_status);

          // Edit mode: Disable and hide fields
          this.disabled(["movement_type"], true);
          this.hide([
            "stock_movement.transfer_stock",
            "stock_movement.view_stock",
          ]);
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
                "driver_name",
                "driver_contact_no",
                "vehicle_no",
                "pickup_date",
                "courier_company",
                "shipping_date",
                "freight_charges",
                "tracking_number",
                "est_arrival_date",
                "est_delivery_date",
                "shipping_company",
                "date_qn0dl3t6",
                "input_77h4nsq8",
                "shipping_method",
                "tracking_no",
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
              "link_billing_address",
              "link_shipping_address",
            ]);
          }
        }
      }
    } else {
      // Add mode
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
