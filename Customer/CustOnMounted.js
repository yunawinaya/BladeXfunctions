const generatePrefix = (runNumber, now, prefixData) => {
  let generated = prefixData.current_prefix_config;
  generated = generated.replace("prefix", prefixData.prefix_value);
  generated = generated.replace("suffix", prefixData.suffix_value);
  generated = generated.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0"),
  );
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(runNumber).padStart(prefixData.padding_zeroes, "0"),
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("Customer")
    .where({ customer_id: generatedPrefix, organization_id: organizationId })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      "Could not generate a unique Customer number after maximum attempts",
    );
  }
  return { prefixToShow, runningNumber };
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);

  this.setData({ customer_id: prefixToShow });
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Customers",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();
  const prefixData = await prefixEntry.data[0];

  if (prefixData.is_active === 0) {
    this.disabled(["customer_id"], false);
  }

  return prefixData;
};

const showStatusHTML = async (status) => {
  switch (status) {
    case "Active":
      this.display(["active_status"]);
      break;
    case "Inactive":
      this.display(["inactive_status"]);
      break;
    case "Suspended":
      this.display(["suspended_status"]);
      break;
    case "Prospect":
      this.display(["prospect_status"]);
      break;
    case "Pending":
      this.display(["pending_status"]);
      break;
  }
};

const disabledField = async () => {
  this.disabled(
    [
      "customer_type",
      "customer_id",
      "customer_com_name",
      "business_type_id",
      "business_activity_id",
      "customer_irbm_id",
      "created_date",
      "customer_com_reg_no",
      "customer_com_old_reg_no",
      "customer_area_id",
      "customer_agent_id",
    ],
    true,
  );
};

const isViewMode = async () => {
  this.hide(["button_cancel", "button_save"]);
};

const checkAccIntegrationType = async (organizationId) => {
  if (organizationId) {
    const resAI = await db
      .collection("accounting_integration")
      .where({ organization_id: organizationId })
      .get();

    if (resAI && resAI.data.length > 0) {
      const aiData = resAI.data[0];

      if (aiData.acc_integration_type === "No Accounting Integration") {
        this.disabled(
          [
            "customer_type",
            "customer_com_reg_no",
            "customer_com_reg_no",
            "customer_com_old_reg_no",
            "business_type_id",
            "customer_irbm_id",
            "customer_area_id",
            "customer_agent_id",
            "customer_currency_id",
            "customer_payment_term_id",
          ],
          false,
        );
      }
    }
  }
};

(async () => {
  try {
    console.log("onmounted");
    const status = await this.getValue("customer_status");
    const pageStatus = this.isAdd
      ? "Add"
      : this.isEdit
        ? "Edit"
        : this.isView
          ? "View"
          : (() => {
              this.$message.error("Invalid page status");
            })();
    console.log("page status", pageStatus);
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ organization_id: organizationId, page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        this.display(["active_status"]);
        this.setData({ is_accurate: 1 });
        await setPrefix(organizationId);
        await checkAccIntegrationType(organizationId);
        break;

      case "Edit":
        await disabledField();
        await showStatusHTML(status);
        this.disabled(
          [
            "customer_id",
            "customer_com_reg_no",
            "customer_com_name",
            "customer_com_reg_no",
            "customer_com_old_reg_no",
            "business_type_id",
            "customer_irbm_id",
            "customer_area_id",
            "customer_agent_id",
            "customer_currency_id",
            "customer_payment_term_id",
          ],
          true,
        );
        await checkAccIntegrationType(organizationId);
        break;

      case "View":
        await showStatusHTML(status);
        await isViewMode();
        break;
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
