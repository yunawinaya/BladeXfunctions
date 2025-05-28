// Helper functions
const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      this.hide(["button_complete"]);
      break;
    case "Issued":
      this.display(["issued_status"]);
      this.hide(["button_draft"]);
      break;
    case "In Progress":
      this.display(["processing_status"]);
      this.hide(["button_draft", "button_issued"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      this.hide(["button_draft", "button_issued", "button_complete"]);
      break;
    default:
      break;
  }
};

const hideCompletionTab = () => {
  setTimeout(() => {
    const dialog = document.querySelector('.el-drawer[role="dialog"]');
    const tabSelector =
      '.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-completion_details[tabindex="-1"][aria-selected="false"]';
    const tab = document.querySelector(tabSelector);

    if (tab) {
      tab.style.display = "none";
    } else {
      const fallbackTab = document.querySelector(
        '.el-drawer[role="dialog"] .el-tabs__item#tab-completion_details'
      );
      if (fallbackTab) {
        fallbackTab.style.display = "none";
      } else {
        console.log("Completion tab not found");
      }
    }

    const inactiveTabSelector =
      '.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-completion_details)';
    const inactiveTab = document.querySelector(inactiveTabSelector);
    if (inactiveTab) {
      inactiveTab.setAttribute("aria-disabled", "true");
      inactiveTab.classList.add("is-disabled");
    }
  }, 100); // Small delay to ensure DOM is ready
};

const generatePrefix = (prefixData) => {
  const now = new Date();
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
    String(prefixData.running_number).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix) => {
  try {
    const existingDoc = await db
      .collection("production_order")
      .where({ production_order_no: generatedPrefix })
      .get();
    return !existingDoc.data || existingDoc.data.length === 0;
  } catch (error) {
    console.error("Error checking uniqueness:", error);
    return false;
  }
};

const findUniquePrefix = async (prefixData) => {
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
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Production Order number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const getPrefixConfiguration = async () => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({ document_types: "Production Order" })
      .get();

    return prefixEntry.data && prefixEntry.data.length > 0
      ? prefixEntry.data[0]
      : null;
  } catch (error) {
    console.error("Error fetching prefix configuration:", error);
    return null;
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";

    // Determine page status
    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    // Set page status in data
    this.setData({ page_status: pageStatus });

    if (pageStatus !== "Add") {
      // Handle Edit/View/Clone modes
      try {
        this.display(["card_process"]);
        this.display(["card_details"]);
        if (this.getValue("process_source") === "Custom Process") {
          this.display(["grid_9gn5igyx"]);
          this.hide(["process_route_no"]);
          this.hide(["process_route_name"]);
        }
        this.display(["table_process_route"]);
        this.display(["card_bom"]);

        const productionOrderId = this.getValue("id");

        const productionOrderResponse = await db
          .collection("production_order")
          .where({ id: productionOrderId })
          .get();

        if (
          productionOrderResponse.data &&
          productionOrderResponse.data.length > 0
        ) {
          const productionOrder = productionOrderResponse.data[0];

          // Extract all fields
          const {
            material_id,
            production_order_no,
            production_order_name,
            plant_id,
            plan_type,
            production_order_status,
            priority,
            planned_qty,
            planned_qty_uom,
            lead_time,
            table_sales_order,
            process_source,
            process_route_no,
            process_route_name,
            table_process_route,
            create_user,
            create_dept,
            create_time,
            update_user,
            update_time,
            is_deleted,
            tenant_id,
            actual_execute_date,
            execute_completion_date,
            completion_remarks,
            yield_qty,
            target_bin_location,
            category,
            table_mat_confirmation,
            batch_id,
            table_bom,
            organization_id,
            balance_index,
          } = productionOrder;

          // Set data for all modes
          const data = {
            material_id,
            production_order_no,
            production_order_name,
            production_order_status,
            plant_id,
            plan_type,
            priority,
            organization_id,
            planned_qty,
            planned_qty_uom,
            lead_time,
            table_sales_order,
            process_source,
            process_route_no,
            process_route_name,
            table_process_route,
            create_user,
            category,
            create_dept,
            create_time,
            update_user,
            update_time,
            is_deleted,
            tenant_id,
            actual_execute_date,
            execute_completion_date,
            completion_remarks,
            yield_qty,
            target_bin_location,
            table_mat_confirmation,
            batch_id,
            table_bom,
            balance_index,
          };

          // Set the data to form
          await this.setData(data);

          // Show appropriate status UI
          showStatusHTML(production_order_status);

          // Handle tab visibility based on status
          if (
            production_order_status !== "Completed" &&
            production_order_status !== "In Progress"
          ) {
            hideCompletionTab();
          }

          if (pageStatus === "Edit") {
            // Disable specific fields for Edit mode
            this.disabled(
              [
                "production_order_no",
                "production_order_name",
                "plant_id",
                "plan_type",
                "material_id",
                "priority",
                "planned_qty",
                "planned_qty_uom",
                "lead_time",
                "table_sales_order",
                "process_source",
                "process_route_no",
                "process_route_name",
                "table_process_route",
                "create_user",
                "create_dept",
                "create_time",
                "update_user",
                "update_time",
                "is_deleted",
                "tenant_id",
                "table_bom",
              ],
              true
            );

            this.disabled(
              [
                "table_mat_confirmation.material_id",
                "table_mat_confirmation.material_name",
                "table_mat_confirmation.material_category",
                "table_mat_confirmation.material_required_qty",
                "table_mat_confirmation.material_required_qty",
                "table_mat_confirmation.item_process_id",
                "table_mat_confirmation.bin_location_id",
              ],
              true
            );
          } else if (pageStatus === "View") {
            // Disable all fields for View mode
            this.disabled(
              [
                "production_order_no",
                "production_order_name",
                "plant_id",
                "plan_type",
                "material_id",
                "priority",
                "planned_qty",
                "category",
                "planned_qty_uom",
                "lead_time",
                "table_sales_order",
                "process_source",
                "process_route_no",
                "process_route_name",
                "table_process_route",
                "create_user",
                "create_dept",
                "create_time",
                "update_user",
                "update_time",
                "is_deleted",
                "tenant_id",
                "table_bom",
                "actual_execute_date",
                "execute_completion_date",
                "completion_remarks",
                "yield_qty",
                "target_bin_location",
                "table_mat_confirmation",
                "batch_id",
              ],
              true
            );

            // Disable edit button
            setTimeout(() => {
              const editButton = document.querySelector(
                ".el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--small.is-link"
              );
              if (editButton) {
                editButton.disabled = true;
              }
            }, 100);

            // Hide action buttons
            this.hide(
              ["button_draft", "button_issued", "button_complete"],
              true
            );
          }
        } else {
          throw new Error(
            `Production Order with ID ${productionOrderId} not found`
          );
        }
      } catch (error) {
        console.error("Error fetching production order:", error);
        this.$message.error(`Error loading production order: ${error.message}`);
      }
    } else {
      // Handle Add mode
      this.display(["draft_status"]);
      this.hide(["button_complete"], true);

      // Hide completion tab in Add mode
      hideCompletionTab();

      try {
        // Get prefix configuration
        const prefixData = await getPrefixConfiguration();

        if (prefixData) {
          if (prefixData.is_active === 0) {
            this.disabled(["production_order_no"], false);
          } else {
            // Generate unique prefix
            const { prefixToShow, runningNumber } = await findUniquePrefix(
              prefixData
            );
            await this.setData({ production_order_no: prefixToShow });
            this.disabled(["production_order_no"], true);
          }
        } else {
          console.warn("No prefix configuration found for Production Order");
          this.disabled(["production_order_no"], false);
        }
      } catch (error) {
        console.error("Error generating prefix:", error);
        this.$message.error(`Error generating prefix: ${error.message}`);
        this.disabled(["production_order_no"], false);
      }
    }
  } catch (error) {
    console.error("Error in production order mounted:", error);
    this.$message.error(error.message || "An error occurred");
  }
})();
