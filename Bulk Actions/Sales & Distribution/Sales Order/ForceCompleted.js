const checkExistingGoodsDelivery = async (soID) => {
  const resGD = await db
    .collection("goods_delivery")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "so_id",
            operator: "in",
            value: soID,
          },
          {
            prop: "gd_status",
            operator: "equal",
            value: "Draft",
          },
        ],
      },
    ])
    .get();

  if (!resGD || resGD.data.length === 0) return [];
  return resGD.data;
};

const checkExistingCreatedGoodsDelivery = async (soID) => {
  const resGD = await db
    .collection("goods_delivery")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "so_id",
            operator: "in",
            value: soID,
          },
          {
            prop: "gd_status",
            operator: "equal",
            value: "Created",
          },
        ],
      },
    ])
    .get();

  if (!resGD || resGD.data.length === 0) return [];
  return resGD.data;
};
const checkExistingSalesInvoice = async (soID) => {
  const resSI = await db
    .collection("sales_invoice")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "so_id",
            operator: "in",
            value: soID,
          },
          {
            prop: "si_status",
            operator: "equal",
            value: "Draft",
          },
        ],
      },
    ])
    .get();

  if (!resSI || resSI.data.length === 0) return [];

  return resSI.data;
};

const deleteRelatedGD = async (existingGD) => {
  try {
    for (const gd of existingGD) {
      await db.collection("goods_delivery").doc(gd.id).update({
        is_deleted: 1,
      });
    }
  } catch {
    throw new Error("Error in deleting associated goods delivery.");
  }
};

const deleteRelatedSI = async (existingSI) => {
  try {
    for (const si of existingSI) {
      await db.collection("sales_invoice").doc(si.id).update({
        is_deleted: 1,
      });
    }
  } catch {
    throw new Error("Error in deleting associated sales invoice.");
  }
};

const completeSO = async (salesOrderId) => {
  try {
    await db.collection("sales_order").doc(salesOrderId).update({
      so_status: "Completed",
    });
  } catch (error) {
    console.error("Error completing SO:", error);
    throw error;
  }
};

(async () => {
  try {
    const unCompletedListID = "custom_odzyd6oo";
    const allListID = "custom_ysv40u3j";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted"
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID
    )?.$refs.crud.tableSelect;

    if (selectedRecords && selectedRecords.length > 0) {
      let salesOrderData = selectedRecords.filter(
        (item) => item.so_status === "Processing" || item.so_status === "Issued"
      );

      if (salesOrderData.length === 0) {
        this.$message.error(
          "Please select at least one processing or issued sales order."
        );
        return;
      }

      // Check for existing GD/SI across all selected SOs
      let allExistingGD = [];
      let allExistingSI = [];
      let allExistingCreatedGD = [];

      for (const soItem of salesOrderData) {
        const existingGD = await checkExistingGoodsDelivery(soItem.id);
        const existingSI = await checkExistingSalesInvoice(soItem.id);
        const existingCreatedGD = await checkExistingCreatedGoodsDelivery(
          soItem.id
        );

        allExistingGD = allExistingGD.concat(existingGD);
        allExistingSI = allExistingSI.concat(existingSI);
        allExistingCreatedGD = allExistingCreatedGD.concat(existingCreatedGD);
      }

      // Check for created GD - block operation if any exist
      if (allExistingCreatedGD.length > 0) {
        const createdGDInfo = allExistingCreatedGD
          .map((gd) => gd.delivery_no)
          .join(", ");
        await this.$alert(
          `These sales orders have existing goods delivery records in created status: <br><strong>GD Numbers:</strong> <br>${createdGDInfo}<br><br>Please cancel all associated goods delivery records before proceeding.`,
          "Existing Created GD detected",
          {
            confirmButtonText: "OK",
            type: "error",
            dangerouslyUseHTMLString: true,
          }
        );
        return;
      }

      // Handle draft GD/SI - ask for confirmation to delete
      if (allExistingGD.length > 0 || allExistingSI.length > 0) {
        const gdInfo =
          allExistingGD.length > 0
            ? allExistingGD.map((gd) => gd.delivery_no).join(", ")
            : "";
        const siInfo =
          allExistingSI.length > 0
            ? allExistingSI.map((si) => si.sales_invoice_no).join(", ")
            : "";

        await this.$confirm(
          `${
            allExistingGD.length > 0
              ? `The selected sales orders have existing goods delivery records in draft status: <br><strong>GD Numbers:</strong> ${gdInfo}<br>Proceeding will delete all associated goods delivery records.<br><br>`
              : ""
          }${
            allExistingSI.length > 0
              ? `The selected sales orders have existing sales invoice records in draft status: <br><strong>SI Numbers:</strong> ${siInfo}<br>Proceeding will delete all associated sales invoice records.<br><br>`
              : ""
          }<strong>Do you wish to continue?</strong>`,
          `Existing ${
            allExistingGD.length > 0 && allExistingSI.length > 0
              ? "GD and SI"
              : allExistingGD.length > 0
              ? "GD"
              : "SI"
          } detected`,
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          throw new Error();
        });

        // Delete related GD and SI
        await deleteRelatedGD(allExistingGD);
        await deleteRelatedSI(allExistingSI);
      }

      // Final confirmation for force completion
      const salesOrderNumbers = salesOrderData.map((item) => item.so_no);

      await this.$confirm(
        `You've selected ${
          salesOrderNumbers.length
        } sales order(s) to force complete. <br> <strong>Sales Order Numbers:</strong> <br>${salesOrderNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Sales Order Force Completion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      // Complete all selected sales orders
      for (const soItem of salesOrderData) {
        await completeSO(soItem.id);
      }

      this.$message.success(
        `Successfully completed ${salesOrderData.length} sales order(s).`
      );
      this.refresh();
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
    if (error.message !== "") {
      this.$message.error("An error occurred during force completion.");
    }
  }
})();
