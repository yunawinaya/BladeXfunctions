const self = this;
const allData = self.getValues();
const pageStatus = this.getParamsVariables("page_status");

if (pageStatus !== "Add") {
  const productionOrderId = this.getParamsVariables("id");
  db.collection("production_order")
    .where({ id: productionOrderId })
    .get()
    .then((response) => {
      const productionOrder = response.data[0];
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

      // Function to set production_order_no based on prefix configuration
      const setStockMovementNoWithPrefix = () => {
        return db
          .collection("prefix_configuration")
          .where({ document_types: "Production Order" })
          .get()
          .then((prefixEntry) => {
            if (prefixEntry && prefixEntry.data[0]) {
              const prefixData = prefixEntry.data[0];
              const now = new Date();
              let prefixToShow = prefixData.current_prefix_config;
              prefixToShow = prefixToShow.replace(
                "prefix",
                prefixData.prefix_value
              );
              prefixToShow = prefixToShow.replace(
                "suffix",
                prefixData.suffix_value
              );
              prefixToShow = prefixToShow.replace(
                "month",
                String(now.getMonth() + 1).padStart(2, "0")
              );
              prefixToShow = prefixToShow.replace(
                "day",
                String(now.getDate()).padStart(2, "0")
              );
              prefixToShow = prefixToShow.replace("year", now.getFullYear());
              prefixToShow = prefixToShow.replace(
                "running_number",
                String(prefixData.running_number).padStart(
                  prefixData.padding_zeroes,
                  "0"
                )
              );
              return prefixToShow;
            }
            return production_order_no; // Fallback to original if no prefix found
          });
      };

      // Display status-specific UI
      switch (data.production_order_status) {
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

      // Keep original production_order_no
      data.production_order_no = production_order_no;
      console.log("productionOrder", productionOrder);
      console.log("data", data);

      this.setData(data);

      // Edit mode: Disable and hide fields
      if (pageStatus === "Edit") {
        // Only hide the tab if status is not Completed or In Progress
        if (
          data.production_order_status !== "Completed" &&
          data.production_order_status !== "In Progress"
        ) {
          this.$nextTick(() => {
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
              console.log("Fallback tab search:", fallbackTab);
              if (fallbackTab) {
                console.log("Fallback tab found, hiding it:", fallbackTab);
                fallbackTab.style.display = "none";
              } else {
                console.log(
                  "Tab not found even with fallback - check if tab-completion_details exists in the DOM inside the dialog"
                );
              }
            }
            const inactiveTabSelector =
              '.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-completion_details)';
            console.log(
              "Attempting to find inactiveTab with selector:",
              inactiveTabSelector
            );
            const inactiveTab = document.querySelector(inactiveTabSelector);
            if (inactiveTab) {
              inactiveTab.setAttribute("aria-disabled", "true");
              inactiveTab.classList.add("is-disabled");
            } else {
              console.log(
                "No other tabs with tabindex='-1' found (excluding tab-completion_details)"
              );
              console.log(
                "All tabs with tabindex='-1' in dialog:",
                dialog
                  ? dialog.querySelectorAll(
                      '.el-tabs__item.is-top[tabindex="-1"]'
                    )
                  : "Dialog not found"
              );
            }
          });
        }

        // Disable fields regardless of status
        this.disabled(
          [
            "production_order_no",
            "production_order_name",
            "plant_id",
            "plan_type",
            "material_id",
            "priority",
            "planned_qty",
            // 'planned_qty_uom',
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
        this.hide([]);
      }

      // View mode: Disable and hide fields
      if (pageStatus === "View") {
        // Only hide the tab if status is not Completed or In Progress
        if (
          data.production_order_status !== "Completed" &&
          data.production_order_status !== "In Progress"
        ) {
          this.$nextTick(() => {
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
              console.log("Fallback tab search:", fallbackTab);
              if (fallbackTab) {
                console.log("Fallback tab found, hiding it:", fallbackTab);
                fallbackTab.style.display = "none";
              } else {
                console.log(
                  "Tab not found even with fallback - check if tab-completion_details exists in the DOM inside the dialog"
                );
              }
            }
            const inactiveTabSelector =
              '.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-completion_details)';
            console.log(
              "Attempting to find inactiveTab with selector:",
              inactiveTabSelector
            );
            const inactiveTab = document.querySelector(inactiveTabSelector);
            if (inactiveTab) {
              inactiveTab.setAttribute("aria-disabled", "true");
              inactiveTab.classList.add("is-disabled");
            } else {
              console.log(
                "No other tabs with tabindex='-1' found (excluding tab-completion_details)"
              );
              console.log(
                "All tabs with tabindex='-1' in dialog:",
                dialog
                  ? dialog.querySelectorAll(
                      '.el-tabs__item.is-top[tabindex="-1"]'
                    )
                  : "Dialog not found"
              );
            }
          });
        }

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

        document.querySelector(
          ".el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--small.is-link"
        ).disabled = true;
        this.hide(["button_draft", "button_issued", "button_complete"], true);
      }
    });
} else {
  // Add mode
  this.display(["draft_status"]);
  this.hide(["button_complete"], true);
  db.collection("prefix_configuration")
    .where({ document_types: "Production Order" })
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
        this.disabled(["production_order_no"], false);
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
          .collection("production_order")
          .where({ production_order_no: generatedPrefix })
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
            "Could not generate a unique Purchase Order number after maximum attempts"
          );
        }
        return { prefixToShow, runningNumber };
      };

      return findUniquePrefix();
    })
    .then(({ prefixToShow, runningNumber }) => {
      this.setData({ production_order_no: prefixToShow });
    })
    .catch((error) => {
      alert(error);
    });

  // Logic to hide tabs in Add mode
  this.$nextTick(() => {
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
      console.log("Fallback tab search:", fallbackTab);
      if (fallbackTab) {
        console.log("Fallback tab found, hiding it:", fallbackTab);
        fallbackTab.style.display = "none";
      } else {
        console.log(
          "Tab not found even with fallback - check if tab-completion_details exists in the DOM inside the dialog"
        );
      }
    }
    const inactiveTabSelector =
      '.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-completion_details)';
    console.log(
      "Attempting to find inactiveTab with selector:",
      inactiveTabSelector
    );
    const inactiveTab = document.querySelector(inactiveTabSelector);
    if (inactiveTab) {
      inactiveTab.setAttribute("aria-disabled", "true");
      inactiveTab.classList.add("is-disabled");
    } else {
      console.log(
        "No other tabs with tabindex='-1' found (excluding tab-completion_details)"
      );
      console.log(
        "All tabs with tabindex='-1' in dialog:",
        dialog
          ? dialog.querySelectorAll('.el-tabs__item.is-top[tabindex="-1"]')
          : "Dialog not found"
      );
    }
  });
}
