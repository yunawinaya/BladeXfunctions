const runGDWorkflow = async (data, needCL, isForceComplete, continueZero) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2017151544868491265",
      {
        allData: data,
        saveAs: "Completed",
        pageStatus: "Edit",
        need_cl: needCL,
        isForceComplete: isForceComplete,
        continueZero: continueZero,
        // Auto-GR decision is carried on the data object so it persists across
        // the 401/403/406 inline retries below (mirrors the GD form client).
        auto_gr_confirmed: data.auto_gr_confirmed || "",
        auto_gr_skip: data.auto_gr_skip || "",
      },
      (res) => {
        console.log("Goods Delivery workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to save Goods Delivery:", err);
        reject(err);
      },
    );
  });
};

// pendingGR: when provided (phase 1), a 408 (auto-GR eligible) is deferred into it
// for a single batch prompt instead of being decided per-GD. Pass null in phase 2.
const handleWorkflowResult = async (workflowResult, gdItem, gdData, pendingGR) => {
  if (!workflowResult || !workflowResult.data) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "No response from workflow",
    };
  }

  const resultCode = workflowResult.data.code;

  // Handle 401 - Zero quantity confirmation - auto-proceed
  if (resultCode === "401" || resultCode === 401) {
    console.log(
      `GD ${gdItem.delivery_no}: Zero quantity warning, auto-proceeding`,
    );
    const retryResult = await runGDWorkflow(gdData, "required", "", "Yes");
    return handleWorkflowResult(retryResult, gdItem, gdData, pendingGR);
  }

  // Handle 402 - Credit limit block
  if (resultCode === "402" || resultCode === 402) {
    const cleanMessage = (
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Credit limit exceeded"
    ).replace(/^Block - /, "");
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: cleanMessage,
    };
  }

  // Handle 403 - Credit limit override - auto-proceed
  if (resultCode === "403" || resultCode === 403) {
    console.log(
      `GD ${gdItem.delivery_no}: Credit limit override, auto-proceeding`,
    );
    const retryResult = await runGDWorkflow(gdData, "not required", "", "");
    return handleWorkflowResult(retryResult, gdItem, gdData, pendingGR);
  }

  // Handle 405 - Must save as Created first (shouldn't happen for bulk)
  if (resultCode === "405" || resultCode === 405) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "Must save as Created first",
    };
  }

  // Handle 406 - Force complete picking - auto-proceed
  if (resultCode === "406" || resultCode === 406) {
    console.log(
      `GD ${gdItem.delivery_no}: Force complete picking, auto-proceeding`,
    );
    const retryResult = await runGDWorkflow(gdData, "", "Yes", "");
    return handleWorkflowResult(retryResult, gdItem, gdData, pendingGR);
  }

  // Handle 407 - Packing not completed
  if (resultCode === "407" || resultCode === 407) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: "Packing must be completed first",
    };
  }

  // Handle 408 - Internal trading: eligible for auto-GR. Defer to one batch
  // prompt (phase 1). The GD is NOT completed yet (the gate returns before save).
  if (resultCode === "408" || resultCode === 408) {
    if (pendingGR) {
      pendingGR.push({ gdItem, gdData });
      return null; // deferred — handled in phase 2
    }
    // No batch context (defensive) — complete without auto-GR.
    gdData.auto_gr_skip = true;
    const retryResult = await runGDWorkflow(gdData, "required", "", "");
    return handleWorkflowResult(retryResult, gdItem, gdData, null);
  }

  // Handle 409 - Internal trading: GD does not fully complete the linked SO
  if (resultCode === "409" || resultCode === 409) {
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error:
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Delivery does not fully complete the linked Sales Order (required for auto-GR).",
    };
  }

  // Handle 410 - GD completed, but auto-GR creation failed (non-blocking)
  if (resultCode === "410" || resultCode === 410) {
    return {
      delivery_no: gdItem.delivery_no,
      success: true,
      warning:
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Completed, but the linked Goods Receipt could not be auto-created.",
    };
  }

  // Handle 400 - General error
  if (
    resultCode === "400" ||
    resultCode === 400 ||
    workflowResult.data.success === false
  ) {
    const errorMessage =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to complete Goods Delivery";
    return {
      delivery_no: gdItem.delivery_no,
      success: false,
      error: errorMessage,
    };
  }

  // Handle success
  if (
    resultCode === "200" ||
    resultCode === 200 ||
    workflowResult.data.success === true
  ) {
    return {
      delivery_no: gdItem.delivery_no,
      success: true,
    };
  }

  return {
    delivery_no: gdItem.delivery_no,
    success: false,
    error: "Unknown workflow status",
  };
};

(async () => {
  try {
    this.showLoading();
    const allListID = "custom_ezwb0qqp";

    const selectedRecords =
      this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    const goodsDeliveryData = selectedRecords.filter(
      (item) => item.gd_status === "Created",
    );

    if (goodsDeliveryData.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one created goods delivery.");
      return;
    }

    const goodsDeliveryNumbers = goodsDeliveryData.map(
      (item) => item.delivery_no,
    );

    await this.$confirm(
      `You've selected ${
        goodsDeliveryNumbers.length
      } goods delivery(s) to complete. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
        ", ",
      )} <br>Do you want to proceed?`,
      "Goods Delivery Completion",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    const results = [];
    const pendingGR = []; // GDs eligible for auto-GR (408), decided via one batch prompt

    // Phase 1: complete everything; defer auto-GR-eligible GDs (they are NOT
    // completed yet — the gate returns 408 before saving).
    for (const gdItem of goodsDeliveryData) {
      const id = gdItem.id;

      const data = await db.collection("goods_delivery").doc(id).get();

      if (!data.data || data.data.length === 0) {
        results.push({
          delivery_no: gdItem.delivery_no,
          success: false,
          error: "Goods Delivery record not found",
        });
        continue;
      }

      try {
        const gdData = data.data[0];
        const workflowResult = await runGDWorkflow(gdData, "required", "", "");
        const result = await handleWorkflowResult(
          workflowResult,
          gdItem,
          gdData,
          pendingGR,
        );
        if (result) results.push(result);
      } catch (error) {
        results.push({
          delivery_no: gdItem.delivery_no,
          success: false,
          error: error.message || "Failed to complete",
        });
      }
    }

    // Phase 2: one prompt for all auto-GR-eligible deliveries, then complete them.
    if (pendingGR.length > 0) {
      this.hideLoading();
      const eligibleNos = pendingGR.map((p) => p.gdItem.delivery_no).join(", ");
      const createGR = await this.$confirm(
        `${pendingGR.length} of the selected delivery(s) are linked to internal Purchase Orders and can auto-create Goods Receipts in the buyer organization.<br><strong>Deliveries:</strong><br>${eligibleNos}<br><br>Create the Goods Receipts now?<br><em>Choosing "No" will still complete the deliveries, without creating GRs.</em>`,
        "Internal Trading – Auto-create Goods Receipts",
        {
          confirmButtonText: "Yes, create GRs",
          cancelButtonText: "No, complete only",
          type: "info",
          dangerouslyUseHTMLString: true,
        },
      )
        .then(() => true)
        .catch(() => false);

      this.showLoading();
      for (const p of pendingGR) {
        if (createGR) {
          p.gdData.auto_gr_confirmed = true;
        } else {
          p.gdData.auto_gr_skip = true;
        }
        try {
          const workflowResult = await runGDWorkflow(
            p.gdData,
            "required",
            "",
            "",
          );
          const result = await handleWorkflowResult(
            workflowResult,
            p.gdItem,
            p.gdData,
            null,
          );
          if (result) results.push(result);
        } catch (error) {
          results.push({
            delivery_no: p.gdItem.delivery_no,
            success: false,
            error: error.message || "Failed to complete",
          });
        }
      }
    }

    // Show summary
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    const warningItems = results.filter((r) => r.success && r.warning);

    if (failCount > 0) {
      const failedItems = results
        .filter((r) => !r.success)
        .map((r) => `${r.delivery_no}: ${r.error}`)
        .join("<br>");
      const warnText =
        warningItems.length > 0
          ? `<br><br><strong>Warnings:</strong><br>${warningItems
              .map((r) => `${r.delivery_no}: ${r.warning}`)
              .join("<br>")}`
          : "";
      this.$message.error(
        `${successCount} succeeded, ${failCount} failed:<br>${failedItems}${warnText}`,
      );
    } else if (warningItems.length > 0) {
      this.$message.warning(
        `All ${successCount} Goods Delivery completed.<br><br><strong>Warnings:</strong><br>${warningItems
          .map((r) => `${r.delivery_no}: ${r.warning}`)
          .join("<br>")}`,
      );
    } else {
      this.$message.success(
        `All ${successCount} Goods Delivery completed successfully`,
      );
    }

    this.hideLoading();
    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
