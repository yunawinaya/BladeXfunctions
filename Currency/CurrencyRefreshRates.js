// Refresh org currency rates from Bank Negara Malaysia (server-side workflow).
// Writes BNM's middle rate to both currency_buying_rate and currency_selling_rate.
const REFRESH_RATES_WORKFLOW_ID = "2100436142094356481";

const runRefreshWorkflow = async (organizationId) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      REFRESH_RATES_WORKFLOW_ID,
      { organization_id: organizationId },
      (res) => {
        console.log("Currency refresh workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to refresh currency rates:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    await this.$confirm(
      "This will overwrite the buying and selling rates for every foreign " +
        "currency in this organization with today's published Bank Negara " +
        "Malaysia rates.<br><br>The base currency is not touched. Do you want to proceed?",
      "Refresh Exchange Rates",
      {
        confirmButtonText: "Yes, Refresh",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      throw new Error("User cancelled the operation");
    });

    this.showLoading("Fetching rates from BNM...");

    const workflowResult = await runRefreshWorkflow(organizationId);

    this.hideLoading();

    const resultCode = workflowResult?.data?.code;
    if (resultCode !== "200" && resultCode !== 200) {
      this.$message.error(
        workflowResult?.data?.message ||
          workflowResult?.data?.msg ||
          "Failed to refresh exchange rates.",
      );
      return;
    }

    this.$message.success(
      workflowResult?.data?.summary ||
        workflowResult?.data?.message ||
        "Exchange rates refreshed.",
    );

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
