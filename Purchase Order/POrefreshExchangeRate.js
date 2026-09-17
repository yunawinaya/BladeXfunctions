// Fetch today's Bank Negara Malaysia rates, then apply this PO's currency rate.
// The workflow refreshes the Currency master for the whole organization and returns
// a code -> rate map, so no second read is needed here.
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
        console.error("Failed to refresh exchange rates:", err);
        reject(err);
      },
    );
  });
};

(async () => {
  try {
    const currencyCode = this.getValue("po_currency");
    if (!currencyCode || currencyCode === "MYR" || currencyCode === "----") {
      return;
    }

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    await this.$confirm(
      `This fetches today's Bank Negara Malaysia rates and updates the ` +
        `exchange rates for <strong>every foreign currency in this organization</strong>, ` +
        `not just ${currencyCode}.<br><br>Do you want to proceed?`,
      "Refresh Exchange Rate",
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

    let workflowResult;
    try {
      workflowResult = await runRefreshWorkflow(organizationId);
    } finally {
      this.hideLoading();
    }

    const resultCode = workflowResult?.data?.code;
    if (resultCode !== "200" && resultCode !== 200) {
      this.$message.error(
        workflowResult?.data?.message ||
          workflowResult?.data?.msg ||
          "Failed to refresh exchange rates.",
      );
      return;
    }

    const rate = parseFloat(workflowResult?.data?.rates?.[currencyCode]);
    if (!rate || Number.isNaN(rate)) {
      this.$message.warning(
        `Rates refreshed, but BNM publishes no rate for ${currencyCode}. ` +
          `The exchange rate on this order is unchanged.`,
      );
      return;
    }

    await this.setData({ exchange_rate: rate });

    // Recompute explicitly - do not rely on the exchange_rate onChange handler firing.
    // Mirrors onTotalChange, which rounds to 4 dp.
    const poTotal = this.getValue("po_total");
    if (poTotal === undefined || poTotal === 0) {
      await this.setData({ myr_total_amount: 0.0 });
    } else {
      await this.setData({
        myr_total_amount: parseFloat((rate * poTotal).toFixed(4)),
      });
    }

    this.$message.success(
      `1 ${currencyCode} = ${rate} MYR` +
        (workflowResult?.data?.rate_date
          ? ` (BNM ${workflowResult.data.rate_date})`
          : ""),
    );
  } catch (error) {
    this.hideLoading();
    if (error?.message !== "User cancelled the operation") {
      console.error("Failed to refresh exchange rate:", error);
      this.$message.error("Failed to refresh exchange rate.");
    }
  }
})();
