const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status", "button_draft", "button_issued"]);
      break;
    case "Issued":
      this.display(["issued_status", "button_issued"]);
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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  try {
    const existingDoc = await db
      .collection("stock_count")
      .where({
        stock_count_no: generatedPrefix,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get();
    return !existingDoc.data || existingDoc.data.length === 0;
  } catch (error) {
    console.error("Error checking uniqueness:", error);
    return false;
  }
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
        document_types: "Stock Count",
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

const setPrefix = async (organizationId) => {
  const prefixData = await checkPrefixConfiguration(organizationId);
  let newPrefix = "";

  if (prefixData) {
    if (prefixData.is_active === 1) {
      const { prefixToShow } = await findUniquePrefix(
        prefixData,
        organizationId
      );
      newPrefix = prefixToShow;
      this.disabled(["stock_count_no"], true);
    } else if (prefixData.is_active === 0) {
      this.disabled(["stock_count_no"], false);
    }
    this.setData({ stock_count_no: newPrefix });
  }
};

const setPlant = async (organizationId) => {
  try {
    const deptId = await this.getVarSystem("deptIds").split(",")[0];
    let plantId = "";

    if (deptId === organizationId) {
      plantId = "";
      await this.disabled(
        ["count_type", "count_method", "blind_count", "start_date", "end_date"],
        true
      );
    } else {
      plantId = deptId;
      await this.disabled("plant_id", true);
    }

    await this.setData({
      organization_id: organizationId,
      plant_id: plantId,
    });
  } catch (error) {
    console.error("Error setting plant:", error);
  }
};

const showStockCount = async (scStatus, reviewStatus) => {
  switch (scStatus) {
    case "Issued":
      this.display(["issued_status"]);
      break;
    case "In Progress":
      this.display(["processing_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    default:
      break;
  }

  await this.display([
    "table_stock_count",
    "table_stock_count.count_qty",
    "button_lock_all",
    "button_count",
  ]);

  const blindCount = await this.getValue("blind_count");
  if (blindCount === 1) {
    await this.hide(["table_stock_count.system_qty"]);
  } else {
    await this.display([
      "table_stock_count.system_qty",
      "table_stock_count.variance_qty",
      "table_stock_count.variance_percentage",
    ]);
  }

  await this.disabled(
    [
      "plant_id",
      "count_type",
      "count_method",
      "blind_count",
      "assignees",
      "user_assignees",
      "work_group_assignees",
    ],
    true
  );

  setTimeout(() => {
    document
      .querySelectorAll(
        "#pane-tab_sc button.el-button--danger.el-button--small"
      )
      .forEach((button) => {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      });
  }, 100);

  setTimeout(async () => {
    if (scStatus === "In Progress") {
      const tableStockCount = await this.getValue("table_stock_count");

      for (let index = 0; index < tableStockCount.length; index++) {
        if (tableStockCount[index].line_status === "Approved") {
          await this.disabled(`table_stock_count.${index}.count_qty`, true);
        } else {
          await this.disabled(`table_stock_count.${index}.count_qty`, false);
        }
      }

      this.models["approvedItems"] = await tableStockCount.filter(
        (item) => item.line_status === "Approved"
      );

      const filteredTableStockCount = await tableStockCount.filter(
        (item) => item.line_status !== "Approved"
      );

      await this.setData({
        table_stock_count: filteredTableStockCount,
      });
    }

    if (reviewStatus === "Recount") {
      this.display(["recount_status"]);
      this.hide(["processing_status"]);

      // unlock Recount
      setTimeout(async () => {
        const tableStockCount = await this.getValue("table_stock_count");
        for (let index = 0; index < tableStockCount.length; index++) {
          if (tableStockCount[index].line_status === "Recount") {
            await this.setData({
              [`table_stock_count.${index}.is_counted`]: 0,
            });
          }
        }
      }, 100);
    }
  }, 100);
};

const showReview = async (scStatus, reviewStatus) => {
  switch (reviewStatus) {
    case "To Be Reviewed":
      this.display(["to_be_reviewed_status"]);
      break;
    case "In Review":
      this.display(["in_review_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Recount":
      this.display(["recount_status"]);
      break;
    default:
      break;
  }

  await this.display([
    "table_stock_count",
    "table_stock_count.count_qty",
    "table_stock_count.adjusted_qty",
    "table_stock_count.variance_qty",
    "table_stock_count.variance_percentage",
    "table_stock_count.review_sub_button",
    "button_review",
    "button_approve_all",
  ]);

  await this.disabled(
    [
      "plant_id",
      "count_type",
      "count_method",
      "blind_count",
      "assignees",
      "user_assignees",
      "work_group_assignees",
      "table_stock_count.count_qty",
    ],
    true
  );

  setTimeout(() => {
    document
      .querySelectorAll(
        "#pane-tab_sc button.el-button--danger.el-button--small"
      )
      .forEach((button) => {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      });
  }, 100);

  setTimeout(async () => {
    if (scStatus === "In Progress") {
      const tableStockCount = await this.getValue("table_stock_count");

      for (let index = 0; index < tableStockCount.length; index++) {
        if (tableStockCount[index].line_status === "Pending") {
          await this.disabled(
            [
              `table_stock_count.${index}.review_status`,
              `table_stock_count.${index}.adjusted_qty`,
              `table_stock_count.${index}.review_sub_button`,
            ],
            true
          );
        } else {
          await this.disabled(
            [
              `table_stock_count.${index}.review_status`,
              `table_stock_count.${index}.adjusted_qty`,
              `table_stock_count.${index}.review_sub_button`,
            ],
            false
          );
        }
      }
    }
  }, 100);

  setTimeout(async () => {
    const tableStockCount = await this.getValue("table_stock_count");
    for (let index = 0; index < tableStockCount.length; index++) {
      if (tableStockCount[index].line_status === "Recounted") {
        await this.setData({
          [`table_stock_count.${index}.review_status`]: "",
        });
      }
    }
  }, 100);
};

(async () => {
  let pageStatus = "";

  if (this.isAdd) pageStatus = "Add";
  else if (this.isEdit) pageStatus = "Edit";
  else if (this.isView) pageStatus = "View";
  else throw new Error("Invalid page state");

  this.setData({ page_status: pageStatus });

  console.log("pageStatus", pageStatus);

  const isStockCount = this.getParamsVariables("is_stock_count");
  const isReview = this.getParamsVariables("is_review");

  console.log("isStockCount", isStockCount);
  console.log("isReview", isReview);

  this.hide(["item_item_balance", "item_batch_balance"]);

  const countType = await this.getValue("count_type");
  console.log("countType", countType);

  const scStatus = await this.getValue("stock_count_status");
  const reviewStatus = await this.getValue("review_status");

  switch (pageStatus) {
    case "Add":
      this.display(["draft_status", "button_draft", "button_issued"]);

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }
      setPlant(organizationId);
      await setPrefix(organizationId);
      break;
    case "Edit":
      await this.display(["table_stock_count"]);

      if (isStockCount) {
        await showStockCount(scStatus, reviewStatus);
      } else if (isReview) {
        await showReview(scStatus, reviewStatus);
      } else {
        if (countType) {
          this.display(["button_select_stock"]);
        }
        showStatusHTML(scStatus);
      }
      break;
    case "View":
      await this.display(["table_stock_count"]);

      if (scStatus && scStatus !== "") {
        await this.display([
          "table_stock_count.count_qty",
          "table_stock_count.variance_qty",
          "table_stock_count.variance_percentage",
        ]);
      }

      if (reviewStatus && reviewStatus !== "") {
        await this.display([
          "table_stock_count.review_status",
          "table_stock_count.adjusted_qty",
        ]);
      }

      break;
  }
})();
