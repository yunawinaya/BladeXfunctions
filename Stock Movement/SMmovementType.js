const data = this.getValues();
const balanceIndex = data.balance_index || [];
let movementType = data.movement_type || "";

const page_status = this.getParamsVariables("page_status");

db.collection("blade_dict")
  .where({ id: movementType })
  .get()
  .then((resMovementType) => {
    movementType = resMovementType.data[0].dict_key;
    console.log("movmenttype", movementType);
  })
  .then(async () => {
    // reset the fields
    await this.setData({
      [`movement_reason`]: "",
      [`stock_movement_no`]: "",
      [`issued_by`]: "",
      [`issuing_operation_faci`]: "",
      [`sm_item_balance`]: [],
      [`table_item_balance`]: [],
      [`stock_movement`]: [],
      [`balance_index`]: [],
    });

    const displayAllFields = () => {
      this.display([
        "stock_movement.item_selection",
        "stock_movement.view_stock",
        "stock_movement.transfer_stock",
        "stock_movement.edit_stock",
        "stock_movement.total_quantity",
        "stock_movement.to_recv_qty",
        "stock_movement.received_quantity",
        "stock_movement.received_quantity_uom",
        "stock_movement.unit_price",
        "stock_movement.amount",
        "stock_movement.location_id",
        "stock_movement.batch_id",
        "stock_movement.category",
        "movement_reason",
        "delivery_method",
        "receiving_operation_faci",
        "is_production_order",
      ]);
    };

    if (movementType) {
      this.disabled(["stock_movement"], false);
    } else {
      this.disabled(["stock_movement"], true);
    }

    // set prefix
    if (page_status !== "View") {
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      await db
        .collection("prefix_configuration")
        .where({
          document_types: "Stock Movement",
          movement_type: movementType,
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
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
          } else {
            this.disabled(["stock_movement_no"], true);
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
                "Could not generate a unique Stock Movement number after maximum attempts"
              );
            }
            return { prefixToShow, runningNumber };
          };

          return findUniquePrefix();
        })
        .then(async ({ prefixToShow, runningNumber }) => {
          await this.setData({ stock_movement_no: prefixToShow });
        })
        .catch((error) => {
          this.$message.error(error);
        });
    }

    // hide/show fields based on movement type
    switch (movementType) {
      case "Inter Operation Facility Transfer":
        displayAllFields();
        this.hide([
          "stock_movement.received_quantity",
          "stock_movement.category",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ]);
        break;

      case "Location Transfer":
        displayAllFields();
        this.hide([
          "delivery_method",
          "receiving_operation_faci",
          "stock_movement.category",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ]);
        this.disabled(["stock_movement.total_quantity"], true);
        break;

      case "Miscellaneous Issue":
        displayAllFields();
        this.hide([
          "receiving_operation_faci",
          "delivery_method",
          "stock_movement.category",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ]);
        this.disabled(["stock_movement.total_quantity"], true);
        break;

      case "Miscellaneous Receipt":
        displayAllFields();
        this.hide([
          "delivery_method",
          "receiving_operation_faci",
          "stock_movement.transfer_stock",
          "stock_movement.total_quantity",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.transfer_stock",
          "stock_movement.view_stock",
          "stock_movement.edit_stock",
        ]);
        break;

      case "Disposal/Scrap":
        displayAllFields();
        this.hide([
          "receiving_operation_faci",
          "delivery_method",
          "stock_movement.category",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ]);
        this.disabled(["stock_movement.total_quantity"], true);
        break;

      case "Inventory Category Transfer Posting":
        displayAllFields();
        this.hide([
          "receiving_operation_faci",
          "delivery_method",
          "movement_reason",
          "stock_movement.category",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ]);
        break;

      case "Inter Operation Facility Transfer (Receiving)":
        displayAllFields();
        this.hide([
          "stock_movement.transfer_stock",
          "stock_movement.amount",
          "is_production_order",
          "delivery_method",
          "receiving_operation_faci",
          "stock_movement.batch_id",
          "stock_movement.view_stock",
          "stock_movement.transfer_stock",
          "stock_movement.edit_stock",
        ]);
        break;

      case "Good Issue":
        displayAllFields();
        this.hide([
          "receiving_operation_faci",
          "delivery_method",
          "stock_movement.category",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ]);
        break;

      case "Production Receipt":
        displayAllFields();
        this.hide([
          "delivery_method",
          "receiving_operation_faci",
          "stock_movement.transfer_stock",
          "stock_movement.total_quantity",
          "stock_movement.to_recv_qty",
          "stock_movement.transfer_stock",
          "stock_movement.view_stock",
          "stock_movement.edit_stock",
        ]);
        break;
    }

    // Helper functions for button visibility
    const hideAllButtons = () => {
      this.hide([
        "button_post",
        "comp_post_button",
        "button_inprogress_ift",
        "button_complete_receive",
        "button_save_as_draft",
        "button_issued_ift",
        "button_completed",
      ]);
    };

    // Apply button visibility logic
    if (
      page_status === "Add" ||
      (data.stock_movement_status === "Draft" && page_status === "Edit")
    ) {
      switch (movementType) {
        case "Inter Operation Facility Transfer (Receiving)":
          hideAllButtons();
          console.log("helllo");
          this.display([
            "button_save_as_draft",
            "button_complete_receive",
            "comp_post_button",
          ]);
          break;
        case "Inter Operation Facility Transfer":
          hideAllButtons();
          this.display(["button_issued_ift", "button_save_as_draft"]);
          break;
        case "Location Transfer":
        case "Inventory Category Transfer Posting":
          hideAllButtons();
          this.display(["button_save_as_draft", "button_completed"]);
          break;
        case "Miscellaneous Issue":
        case "Good Issue":
        case "Miscellaneous Receipt":
        case "Production Receipt":
        case "Disposal/Scrap":
          hideAllButtons();
          this.display([
            "button_save_as_draft",
            "button_completed",
            "comp_post_button",
          ]);
          break;
      }
    } else if (
      data.stock_movement_status === "Issued" &&
      page_status === "Edit" &&
      movementType === "Inter Operation Facility Transfer"
    ) {
      hideAllButtons();
      this.display(["button_inprogress_ift"]);
    } else if (
      data.stock_movement_status === "Completed" &&
      page_status === "View"
    ) {
      hideAllButtons();
      if (
        [
          "Inter Operation Facility Transfer",
          "Miscellaneous Issue",
          "Good Issue",
          "Miscellaneous Receipt",
          "Production Receipt",
          "Disposal/Scrap",
          "Inter Operation Facility Transfer (Receiving)",
        ].includes(movementType)
      ) {
        this.display(["button_post"]);
      }
    } else if (
      data.stock_movement_status === "Created" &&
      (page_status === "View" || page_status === "Edit") &&
      movementType === "Inter Operation Facility Transfer (Receiving)"
    ) {
      hideAllButtons();
      this.display(["button_complete_receive"]);
    }

    // if (
    //   page_status !== "Add" && movementType &&
    //   savedBalanceIndex &&
    //   savedBalanceIndex.length > 0
    // ) {
    //   setTimeout(() => {
    //     this.setData({
    //       [`balance_index`]: savedBalanceIndex,
    //     });
    //   }, 2000);
    // }
  });
