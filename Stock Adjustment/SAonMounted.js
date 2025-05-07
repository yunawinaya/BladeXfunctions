// Helper functions
const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
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
      .collection("stock_adjustment")
      .where({ adjustment_no: generatedPrefix })
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
      "Could not generate a unique Stock Adjustment number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const checkPrefixConfiguration = async (organizationId) => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Stock Adjustment",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .get();

    return prefixEntry.data && prefixEntry.data.length > 0
      ? prefixEntry.data[0]
      : null;
  } catch (error) {
    console.error("Error checking prefix configuration:", error);
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

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    if (pageStatus !== "Add") {
      // Handle Edit/View/Clone modes
      const stockAdjustmentId = this.getValue("id");

      const resSA = await db
        .collection("stock_adjustment")
        .where({ id: stockAdjustmentId })
        .get();

      if (resSA.data && resSA.data.length > 0) {
        const stockAdjustment = resSA.data[0];
        const {
          stock_adjustment_status,
          adjustment_no,
          organization_id,
          adjustment_date,
          adjustment_type,
          adjusted_by,
          plant_id,
          adjustment_remarks,
          reference_documents,
          subform_dus1f9ob,
          table_index,
        } = stockAdjustment;

        const sa = {
          stock_adjustment_status,
          adjustment_no,
          organization_id,
          adjustment_date,
          adjustment_type,
          adjusted_by,
          plant_id,
          adjustment_remarks,
          reference_documents,
          subform_dus1f9ob,
          table_index,
        };

        // Set data for all modes
        await this.setData(sa);

        // Show appropriate status UI
        showStatusHTML(stock_adjustment_status);

        if (pageStatus === "Edit") {
          // Handle Edit mode
          if (stock_adjustment_status === "Draft") {
            this.hide("button_posted");
            this.hide("subform_dus1f9ob.link_adjust_stock");
            this.hide("subform_dus1f9ob.view_link");
            this.hide("subform_dus1f9ob.balance_index");
          }

          // Check if prefix is active
          const prefixConfig = await checkPrefixConfiguration(organizationId);
          if (prefixConfig && prefixConfig.is_active === 0) {
            this.disabled(["adjustment_no"], false);
          }
        } else if (pageStatus === "View") {
          // Handle View mode: disable all fields
          this.disabled(
            [
              "stock_adjustment_status",
              "adjustment_no",
              "adjustment_date",
              "adjustment_type",
              "adjusted_by",
              "plant_id",
              "adjustment_remarks",
              "table_item_balance",
              "reference_documents",
              "subform_dus1f9ob.adjustment_reason",
              "subform_dus1f9ob.adjustment_remarks",
              "subform_dus1f9ob.divider_tiqnndpq",
              "subform_dus1f9ob.material_id",
              "subform_dus1f9ob.total_quantity",
            ],
            true
          );

          // Hide add button for subform
          setTimeout(() => {
            const addButton = document.querySelector(
              ".form-subform-action .el-button--primary"
            );
            if (addButton) {
              addButton.style.display = "none";
            }
          }, 500);

          this.disabled(["subform_dus1f9ob.view_link"], false);
          this.hide("subform_dus1f9ob.link_adjust_stock");
          this.hide("subform_dus1f9ob.readjust_link");

          // Show/hide buttons based on status
          if (stock_adjustment_status === "Completed") {
            this.hide([
              "button_save_as_draft",
              "button_completed",
              "button_completed_posted",
            ]);
          } else {
            this.hide([
              "button_save_as_draft",
              "button_completed",
              "button_posted",
              "button_completed_posted",
            ]);
          }
        }
      } else {
        throw new Error(
          `Stock Adjustment with ID ${stockAdjustmentId} not found`
        );
      }
    } else {
      // Handle Add mode
      this.display(["draft_status"]);
      this.hide("subform_dus1f9ob.view_link");
      this.hide("subform_dus1f9ob.readjust_link");
      this.hide("subform_dus1f9ob.balance_index");
      this.hide("button_posted");
      this.reset();

      try {
        // Get prefix configuration
        const prefixData = await checkPrefixConfiguration(organizationId);

        if (prefixData) {
          if (prefixData.is_active === 0) {
            this.disabled(["adjustment_no"], false);
          } else {
            // Generate unique prefix
            const { prefixToShow, runningNumber } = await findUniquePrefix(
              prefixData
            );
            await this.setData({ adjustment_no: prefixToShow });
            this.disabled(["adjustment_no"], true);
          }
        } else {
          console.warn("No prefix configuration found for Stock Adjustment");
          this.disabled(["adjustment_no"], false);
        }
      } catch (error) {
        console.error("Error generating prefix:", error);
        this.$message.error(`Error generating prefix: ${error.message}`);
        this.disabled(["adjustment_no"], false);
      }
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
