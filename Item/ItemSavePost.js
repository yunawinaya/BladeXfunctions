// ITEM_SAVE — the server-side save; see Item/ItemSaveWorkflow.json.
const ITEM_SAVE_WORKFLOW_ID = "2098251509145264130";

const SQL_HEALTH_CHECK_WORKFLOW_ID = "1958732352162164738";
const SQL_POST_ITEM_WORKFLOW_ID = "1906666085143818241";
const AUTOCOUNT_POST_ITEM_WORKFLOW_ID = "1991400333408145410";
const AGENT_TASK_WORKFLOW_ID = "2013511169625042946";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }

    return obj.toString();
  }
  return null;
};

// The item is already committed by the time we get here, so a posting failure
// must surface as its own message and never as a failed save.
const postToAccounting = async (accType, agentId, itemId) => {
  switch (accType) {
    case "SQL Accounting":
      await this.runWorkflow(
        SQL_HEALTH_CHECK_WORKFLOW_ID,
        { key: "value" },
        async (res) => {
          if (res.data.status === "running") {
            await this.runWorkflow(
              SQL_POST_ITEM_WORKFLOW_ID,
              { key: "value" },
              () => {
                this.$message.success("Save item successfully.");
                closeDialog();
              },
              (err) => {
                console.error(err);
                this.hideLoading();
                throw new Error(
                  "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
                );
              },
            );
          }
        },
        (err) => {
          console.error(err);
          this.hideLoading();
          throw new Error(
            "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
          );
        },
      );
      break;

    case "AutoCount Accounting":
      await this.runWorkflow(
        AUTOCOUNT_POST_ITEM_WORKFLOW_ID,
        { key: "value" },
        () => {
          this.$message.success("Save item successfully.");
          closeDialog();
        },
        (err) => {
          console.error(err);
          this.hideLoading();
          throw new Error(
            "Your AutoCount accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
          );
        },
      );
      break;

    case "SQL Accounting V2":
    case "AutoCount Accounting V2":
      await this.runWorkflow(
        AGENT_TASK_WORKFLOW_ID,
        {
          agent_id: agentId,
          task_type: "post_item",
          payload: [itemId],
          priority: "0",
        },
        () => {
          this.$message.success("Save item successfully.");
          closeDialog();
        },
        (err) => {
          console.error(err);
          this.hideLoading();
        },
      );
      break;

    default:
      // "No Accounting Integration", or no integration row at all.
      this.$message.success("Save item successfully.");
      closeDialog();
      break;
  }
};

(async () => {
  try {
    this.showLoading("Saving Item...");

    await this.validate();

    const data = this.getValues();
    data.is_post = 1;

    await this.runWorkflow(
      ITEM_SAVE_WORKFLOW_ID,
      { allData: data },
      async (res) => {
        const out = (res && res.data) || {};
        await postToAccounting(out.acc_integration_type, out.agent_id, out.id);
      },
      (error) => {
        this.hideLoading();
        console.error(error);
        this.$message.error(
          error?.data?.msg || "An error occurred while saving the item.",
        );
      },
    );
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";
    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(error);
  }
})();
