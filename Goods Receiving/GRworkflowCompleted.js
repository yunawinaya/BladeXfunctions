const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const runGRWorkflow = async (data, continueZero) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2029090678383042562",
      {
        allData: data,
        saveAs: "Completed",
        pageStatus: data.page_status,
        continueZero: continueZero,
      },
      (res) => {
        console.log("Goods Receiving workflow response:", res);
        resolve(res);
      },
      (err) => {
        console.error("Failed to save Goods Receiving:", err);
        reject(err);
      },
    );
  });
};

const handleWorkflowResult = async (workflowResult, data) => {
  if (!workflowResult || !workflowResult.data) {
    this.hideLoading();
    this.$message.error("No response from workflow");
    return;
  }

  const resultCode = workflowResult.data.code;

  // Handle 401 - Zero quantity confirmation
  if (resultCode === "401" || resultCode === 401) {
    this.hideLoading();
    const message =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Some lines have zero receive quantity. Would you like to proceed?";

    try {
      await this.$confirm(message, "", {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      });

      // User clicked Proceed - re-run workflow with continueZero = "Yes"
      this.showLoading("Saving Goods Receiving as Completed...");
      const retryResult = await runGRWorkflow(data, "Yes");
      await handleWorkflowResult(retryResult, data);
    } catch (e) {
      console.log("User clicked Cancel or closed the dialog");
      this.hideLoading();
    }
    return;
  }

  // Handle 400 - General error
  if (
    resultCode === "400" ||
    resultCode === 400 ||
    workflowResult.data.success === false
  ) {
    this.hideLoading();
    const errorMessage =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to save Goods Receiving";
    this.$message.error(errorMessage);
    return;
  }

  // Handle success
  if (
    resultCode === "200" ||
    resultCode === 200 ||
    workflowResult.data.success === true
  ) {
    this.hideLoading();
    const successMessage =
      workflowResult.data.message ||
      workflowResult.data.msg ||
      "Goods Receiving saved successfully";
    this.$message.success(successMessage);
    closeDialog();
  } else {
    this.hideLoading();
    this.$message.error("Unknown workflow status");
  }
};

const processRow = async (item, organizationId) => {
  if (item.item_batch_no === "Auto-generated batch number") {
    const resBatchConfig = await db
      .collection("batch_level_config")
      .where({ organization_id: organizationId })
      .get();

    if (resBatchConfig && resBatchConfig.data.length > 0) {
      const batchConfigData = resBatchConfig.data[0];
      let batchDate = "";
      let dd,
        mm,
        yy = "";

      switch (batchConfigData.batch_format) {
        case "Document Date":
          let issueDate = this.getValue("issue_date");

          if (!issueDate)
            throw new Error(
              "Issue Date is required for generating batch number.",
            );

          issueDate = new Date(issueDate);

          dd = String(issueDate.getDate()).padStart(2, "0");
          mm = String(issueDate.getMonth() + 1).padStart(2, "0");
          yy = String(issueDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;
          break;

        case "Document Created Date":
          let createdDate = new Date().toISOString().split("T")[0];

          createdDate = new Date(createdDate);

          dd = String(createdDate.getDate()).padStart(2, "0");
          mm = String(createdDate.getMonth() + 1).padStart(2, "0");
          yy = String(createdDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;
          break;

        case "Manufacturing Date by Quarter":
          let manufacturingDatebyQ = item.manufacturing_date;

          if (!manufacturingDatebyQ)
            throw new Error(
              "Manufacturing Date is required for generating batch number.",
            );

          manufacturingDatebyQ = new Date(manufacturingDatebyQ);

          yy = String(manufacturingDatebyQ.getFullYear()).slice(-2);

          const month = manufacturingDatebyQ.getMonth() + 1;
          let quarter;
          if (month <= 3) quarter = "01";
          else if (month <= 6) quarter = "02";
          else if (month <= 9) quarter = "03";
          else quarter = "04";

          batchDate = yy + quarter;
          break;

        case "Manufacturing Date":
          let manufacturingDate = item.manufacturing_date;

          if (!manufacturingDate)
            throw new Error(
              "Manufacturing Date is required for generating batch number.",
            );

          manufacturingDate = new Date(manufacturingDate);

          dd = String(manufacturingDate.getDate()).padStart(2, "0");
          mm = String(manufacturingDate.getMonth() + 1).padStart(2, "0");
          yy = String(manufacturingDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;
          break;

        case "Expired Date":
          let expiredDate = item.expired_date;

          if (!expiredDate)
            throw new Error(
              "Expired Date is required for generating batch number.",
            );

          expiredDate = new Date(expiredDate);

          dd = String(expiredDate.getDate()).padStart(2, "0");
          mm = String(expiredDate.getMonth() + 1).padStart(2, "0");
          yy = String(expiredDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;
          break;
      }

      let batchPrefix = batchConfigData.batch_prefix || "";
      if (batchPrefix) batchPrefix += "-";

      const generatedBatchNo =
        batchPrefix +
        batchDate +
        "-" +
        String(batchConfigData.batch_running_number).padStart(
          batchConfigData.batch_padding_zeroes,
          "0",
        );

      item.item_batch_no = generatedBatchNo;
      await db
        .collection("batch_level_config")
        .where({ id: batchConfigData.id })
        .update({
          batch_running_number: batchConfigData.batch_running_number + 1,
        });

      return item;
    }
  }
  return item;
};

(async () => {
  try {
    this.showLoading("Saving Goods Receiving as Completed...");

    const data = this.getValues();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Process each row for batch number generation
    // For split items: only parent generates batch, children inherit from parent
    const processedTableGR = [];

    for (const [index, item] of data.table_gr.entries()) {
      await this.validate(`table_gr.${index}.item_batch_no`);

      // For split parent: generate batch normally
      if (item.is_split === "Yes" && item.parent_or_child === "Parent") {
        const processedItem = await processRow(item, organizationId);
        processedTableGR.push(processedItem);
      }
      // For child: use parent's batch number and dates (don't generate new)
      else if (item.parent_or_child === "Child") {
        // Find parent's batch and dates from already-processed rows
        const parentRow = processedTableGR.find(
          (row) =>
            row.is_split === "Yes" &&
            row.parent_or_child === "Parent" &&
            row.parent_index === item.parent_index,
        );
        if (parentRow) {
          item.item_batch_no = parentRow.item_batch_no;
          item.manufacturing_date = parentRow.manufacturing_date;
          item.expired_date = parentRow.expired_date;
        }
        processedTableGR.push(item);
      }
      // For regular non-split row: generate batch as normal
      else {
        const processedItem = await processRow(item, organizationId);
        processedTableGR.push(processedItem);
      }
    }
    data.table_gr = processedTableGR;

    // Recalculate split parent's received_qty from children
    // (User can edit child quantities after splitting, so parent may be out of sync)
    for (const item of data.table_gr) {
      if (item.is_split === "Yes" && item.parent_or_child === "Parent") {
        // Find all children belonging to this parent
        const children = data.table_gr.filter(
          (row) =>
            row.parent_or_child === "Child" &&
            row.parent_index === item.parent_index
        );

        // Sum children's quantities
        const totalChildQty = children.reduce(
          (sum, child) => sum + (parseFloat(child.received_qty) || 0),
          0
        );
        const totalChildBaseQty = children.reduce(
          (sum, child) => sum + (parseFloat(child.base_received_qty) || 0),
          0
        );

        // Update parent with actual totals
        item.received_qty = parseFloat(totalChildQty.toFixed(3));
        item.base_received_qty = parseFloat(totalChildBaseQty.toFixed(3));
      }
    }

    const workflowResult = await runGRWorkflow(data, "");
    await handleWorkflowResult(workflowResult, data);
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Goods Receiving";
    this.$message.error(errorMessage);
  }
})();
