const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const showCreditLimitPopup = (popupNumber, creditLimitData) => {
  this.openDialog("dialog_credit_limit");

  this.hide([
    "dialog_credit_limit.alert_credit_limit",
    "dialog_credit_limit.alert_overdue_limit",
    "dialog_credit_limit.alert_credit_overdue",
    "dialog_credit_limit.alert_suspended",
    "dialog_credit_limit.text_credit_limit",
    "dialog_credit_limit.text_overdue_limit",
    "dialog_credit_limit.text_credit_overdue",
    "dialog_credit_limit.text_suspended",
    "dialog_credit_limit.total_allowed_credit",
    "dialog_credit_limit.total_credit",
    "dialog_credit_limit.total_allowed_overdue",
    "dialog_credit_limit.total_overdue",
    "dialog_credit_limit.text_1",
    "dialog_credit_limit.text_2",
    "dialog_credit_limit.text_3",
    "dialog_credit_limit.text_4",
    "dialog_credit_limit.button_back",
    "dialog_credit_limit.button_no",
    "dialog_credit_limit.button_yes",
  ]);

  const popupConfigs = {
    1: {
      // Pop-up 1: Exceed Credit Limit Only (Block)
      alert: "alert_credit_limit",
      text: "text_credit_limit",
      showCredit: true,
      showOverdue: false,
      isBlock: true,
      buttonText: "text_1",
    },
    2: {
      // Pop-up 2: Exceed Overdue Limit Only (Block)
      alert: "alert_overdue_limit",
      text: "text_overdue_limit",
      showCredit: false,
      showOverdue: true,
      isBlock: true,
      buttonText: "text_2",
    },
    3: {
      // Pop-up 3: Exceed Both, Credit Limit and Overdue Limit (Block)
      alert: "alert_credit_overdue",
      text: "text_credit_overdue",
      showCredit: true,
      showOverdue: true,
      isBlock: true,
      buttonText: "text_3",
    },
    4: {
      // Pop-up 4: Exceed Overdue Limit Only (Override)
      alert: "alert_overdue_limit",
      text: "text_overdue_limit",
      showCredit: false,
      showOverdue: true,
      isBlock: false,
      buttonText: "text_4",
    },
    5: {
      // Pop-up 5: Exceed Credit Limit Only (Override)
      alert: "alert_credit_limit",
      text: "text_credit_limit",
      showCredit: true,
      showOverdue: false,
      isBlock: false,
      buttonText: "text_4",
    },
    6: {
      // Pop-up 6: Suspended
      alert: "alert_suspended",
      text: "text_suspended",
      showCredit: false,
      showOverdue: false,
      isBlock: true,
      buttonText: null,
    },
    7: {
      // Pop-up 7: Exceed Both, Credit Limit and Overdue Limit (Override)
      alert: "alert_credit_overdue",
      text: "text_credit_overdue",
      showCredit: true,
      showOverdue: true,
      isBlock: false,
      buttonText: "text_4",
    },
  };

  const config = popupConfigs[popupNumber];
  if (!config) return false;

  // Show alert message
  this.display(`dialog_credit_limit.${config.alert}`);

  // Show description text
  this.display(`dialog_credit_limit.${config.text}`);

  const dataToSet = {};

  // Show credit limit details if applicable
  if (config.showCredit) {
    this.display("dialog_credit_limit.total_allowed_credit");
    this.display("dialog_credit_limit.total_credit");
    dataToSet["dialog_credit_limit.total_allowed_credit"] =
      creditLimitData.creditLimit;
    dataToSet["dialog_credit_limit.total_credit"] =
      creditLimitData.revisedOutstandingAmount;
  }

  // Show overdue limit details if applicable
  if (config.showOverdue) {
    this.display("dialog_credit_limit.total_allowed_overdue");
    this.display("dialog_credit_limit.total_overdue");
    dataToSet["dialog_credit_limit.total_allowed_overdue"] =
      creditLimitData.overdueLimit;
    dataToSet["dialog_credit_limit.total_overdue"] =
      creditLimitData.overdueAmount;
  }

  // Show action text if applicable
  if (config.buttonText) {
    this.display(`dialog_credit_limit.${config.buttonText}`);
  }

  // Show appropriate buttons
  if (config.isBlock) {
    this.display("dialog_credit_limit.button_back"); // "Back" button
  } else {
    this.display("dialog_credit_limit.button_yes"); // "Yes" button
    this.display("dialog_credit_limit.button_no"); // "No" button
  }

  this.setData(dataToSet);
  return false;
};

(async () => {
  try {
    this.showLoading("Issuing Sales Order...");

    const data = this.getValues();
    console.log("data", data);

    let workflowResult;

    await this.runWorkflow(
      "1988908545345945602",
      { entry: data, saveAs: "Issued" },
      async (res) => {
        console.log("Sales Order issued successfully:", res);
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to issue Sales Order:", err);
        workflowResult = err;
      }
    );

    if (
      workflowResult.data.errorStatus &&
      workflowResult.data.errorStatus !== ""
    ) {
      if (workflowResult.data.errorStatus === "missingFields") {
        this.hideLoading();
        this.$message.error(
          `Validation errors: ${workflowResult.data.message}`
        );
        return;
      }

      if (workflowResult.data.errorStatus === "validateQuantity") {
        if (
          workflowResult.data.quantityFailValFields.length > 0 ||
          workflowResult.data.itemFailValFields.length > 0
        ) {
          this.hideLoading();
          await this.$alert(
            `${
              workflowResult.data.quantityFailValFields.length > 0
                ? "The following items have quantity less than or equal to zero: " +
                  workflowResult.data.quantityFailValFields.join(", ") +
                  "<br><br>"
                : ""
            }
          ${
            workflowResult.data.itemFailValFields.length > 0
              ? "The following items have quantity but missing item code: Line " +
                workflowResult.data.itemFailValFields.join(", Line ")
              : ""
          }`,
            "Line Item Validation Failed",
            {
              confirmButtonText: "OK",
              type: "error",
              dangerouslyUseHTMLString: true,
            }
          );
          return;
        }
      }

      if (workflowResult.data.errorStatus === "CreditLimit") {
        this.hideLoading();
        const popupNumber = workflowResult.data.popupNumberCL;
        const creditLimitData = workflowResult.data.creditLimitData;

        // Show the credit limit popup
        showCreditLimitPopup(popupNumber, creditLimitData);
        return;
      }

      if (workflowResult.data.errorStatus === "ExistingGDandSI") {
        if (
          workflowResult.data.existingGDLength > 0 ||
          workflowResult.data.existingSILength > 0
        ) {
          this.hideLoading();
          await this.$alert(
            `${
              workflowResult.data.existingGDLength > 0
                ? "The sales order has existing goods delivery records in draft status. Please delete all associated goods delivery records.<br><br>"
                : ""
            }
              ${
                workflowResult.data.existingSILength > 0
                  ? "The sales order has existing sales invoice records in draft status. Please delete all associated sales invoice records.<br><br>"
                  : ""
              }`,
            `Existing ${
              workflowResult.data.existingGDLength &&
              workflowResult.data.existingSILength > 0
                ? "GD and SI"
                : workflowResult.data.existingGDLength > 0
                ? "GD"
                : workflowResult.data.existingSILength > 0
                ? "SI"
                : ""
            } detected`,
            {
              confirmButtonText: "OK",
              type: "error",
              dangerouslyUseHTMLString: true,
            }
          );
          return;
        }
      }

      // Handle any other error status
      if (workflowResult.data.message) {
        this.hideLoading();
        this.$message.error(workflowResult.data.message);
        return;
      }
    }

    if (workflowResult.data.status === "Success") {
      console.log("workflowResult", workflowResult);
      this.$message.success("Sales Order issued successfully");
      this.hideLoading();
      closeDialog();
    }
  } catch (error) {
    console.error("Error:", error);
    this.$message.error("Failed to issue Sales Order");
    this.hideLoading();
    closeDialog();
  }
})();
