const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const processRow = async (item, organizationId) => {
  if (item.batch_no === "Auto-generated batch number") {
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

      item.batch_no = generatedBatchNo;
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
    this.showLoading("Saving Plant Transfer as Completed...");

    const data = this.getValues();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const resPlantTransferSetup = await db
      .collection("plant_transfer_setup")
      .where({
        organization_id: organizationId,
      })
      .get();

    if (
      !resPlantTransferSetup.data ||
      resPlantTransferSetup.data.length === 0
    ) {
      this.hideLoading();
      this.$message.error("No Plant Transfer Setup found");
      return;
    }

    const isGenerateBatch = resPlantTransferSetup.data[0].generate_new_batch;
    if (isGenerateBatch) {
      // Process each row for batch number generation
      const processedTableSM = [];
      for (const [index, item] of data.stock_movement.entries()) {
        await this.validate(`stock_movement.${index}.batch_no`);
        const processedItem = await processRow(item, organizationId);
        processedTableSM.push(processedItem);
      }
      data.stock_movement = processedTableSM;
    }

    let workflowResult;

    await this.runWorkflow(
      "2025864403783462913",
      { allData: data, saveAs: "Completed", pageStatus: data.page_status },
      async (res) => {
        workflowResult = res;
      },
      (err) => {
        console.error("Failed to save Plant Transfer:", err);
        this.hideLoading();
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    if (
      workflowResult.data.code === "400" ||
      workflowResult.data.code === 400 ||
      workflowResult.data.success === false
    ) {
      this.hideLoading();
      const errorMessage =
        workflowResult.data.msg ||
        workflowResult.data.message ||
        "Failed to save Plant Transfer";
      this.$message.error(errorMessage);
      return;
    }

    if (
      workflowResult.data.code === "200" ||
      workflowResult.data.code === 200 ||
      workflowResult.data.success === true
    ) {
      this.hideLoading();
      const successMessage =
        workflowResult.data.message ||
        workflowResult.data.msg ||
        "Plant Transfer saved successfully";
      this.$message.success(successMessage);
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error("Unknown workflow status");
    }
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage = error.message || "Failed to save Plant Transfer";
    this.$message.error(errorMessage);
  }
})();
