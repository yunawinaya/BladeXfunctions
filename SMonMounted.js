const page_status = this.getParamsVariables("page_status");

let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

if (page_status !== "Add") {
  const stockMovementId = this.getParamsVariables("stock_movement_no");
  db.collection("stock_movement")
    .where({ id: stockMovementId })
    .get()
    .then((resSM) => {
      const stockMovement = resSM.data[0];
      const {
        stock_movement_status,
        issue_date,
        stock_movement_no,
        movement_type,
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
        shipping_company,
        date_qn0dl3t6,
        input_77h4nsq8,
        shipping_method,
        tracking_no,
        stock_movement,
        balance_index,
      };

      // Handle stock_movement_no based on page_status and stock_movement_status
      if (page_status !== "Clone") {
        if (stock_movement_status === "Draft") {
          const prefixEntry = db
            .collection("prefix_configuration")
            .where({
              document_types: "Stock Movement",
              is_deleted: 0,
              organization_id: organizationId,
            })
            .get()
            .then((prefixEntry) => {
              if (prefixEntry.data[0].is_active === 0) {
                this.disabled(["stock_movement_no"], false);
              }
            });
          // Override stock_movement_no for Draft status
          this.setData(data);
          this.display(["draft_status"]);
        } else {
          // Keep original stock_movement_no
          data.stock_movement_status = stock_movement_status;
          data.stock_movement_no = stock_movement_no;
          this.setData(data);
        }
      } else {
        // Clone case
        const prefixEntry = db
          .collection("prefix_configuration")
          .where({
            document_types: "Stock Movement",
            is_deleted: 0,
            organization_id: organizationId,
          })
          .get()
          .then((prefixEntry) => {
            if (prefixEntry.data[0].is_active === 0) {
              this.disabled(["stock_movement_no"], false);
            }
          });
        this.setData(data);
        this.display(["draft_status"]);
      }

      // Display status-specific UI
      switch (data.stock_movement_status) {
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
        default:
          break;
      }

      // Edit mode: Disable and hide fields
      if (page_status === "Edit") {
        this.disabled([], true);
        this.hide([
          "stock_movement.transfer_stock",
          "stock_movement.view_stock",
        ]);
      }

      // View mode: Disable and hide fields
      if (page_status === "View") {
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
            "stock_movement.target_location",
          ],
          true
        );
        document.querySelector(
          ".el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--small.is-link"
        ).disabled = true;
        this.hide(
          [
            "stock_movement.transfer_stock",
            "stock_movement.edit_stock",
            "link_billing_address",
            "link_shipping_address",
          ],
          true
        );
      }
    });
} else {
  // Add mode
  this.disabled(["stock_movement"], true);
  this.display("button_save_as_draft");
  this.display(["draft_status"]);
  const prefixEntry = db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Movement",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get()
    .then((prefixEntry) => {
      const prefixData = prefixEntry.data[0];
      const now = new Date();
      let prefixToShow;
      let runningNumber = prefixData.running_number;
      let isUnique = false;
      let maxAttempts = 10;
      let attempts = 0;

      if (prefixData.is_active === 0) {
        this.disabled(["stock_movement_no"], false);
      }

      const generatePrefix = (runNumber) => {
        let generated = prefixData.current_prefix_config;
        generated = generated.replace("prefix", prefixData.prefix_value);
        generated = generated.replace("suffix", prefixData.suffix_value);
        generated = generated.replace(
          "month",
          String(now.getMonth() + 1).padStart(2, "0")
        );
        generated = generated.replace(
          "day",
          String(now.getDate()).padStart(2, "0")
        );
        generated = generated.replace("year", now.getFullYear());
        generated = generated.replace(
          "running_number",
          String(runNumber).padStart(prefixData.padding_zeroes, "0")
        );
        return generated;
      };

      const checkUniqueness = async (generatedPrefix) => {
        const existingDoc = await db
          .collection("stock_movement")
          .where({ stock_movement_no: generatedPrefix })
          .get();
        return existingDoc.data[0] ? false : true;
      };

      const findUniquePrefix = async () => {
        while (!isUnique && attempts < maxAttempts) {
          attempts++;
          prefixToShow = generatePrefix(runningNumber);
          isUnique = await checkUniqueness(prefixToShow);
          if (!isUnique) {
            runningNumber++;
          }
        }

        if (!isUnique) {
          throw new Error(
            "Could not generate a unique Quotation number after maximum attempts"
          );
        }
        return { prefixToShow, runningNumber };
      };

      return findUniquePrefix();
    })
    .then(({ prefixToShow, runningNumber }) => {
      this.setData({ stock_movement_no: prefixToShow });
      this.setData({ stock_movement_status: "Draft" });
    })
    .catch((error) => {
      alert(error);
    });
}
