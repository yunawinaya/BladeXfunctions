const checkExistingGoodsReceiving = async (poID) => {
  const resGR = await db
    .collection("goods_receiving")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "po_id",
            operator: "in",
            value: poID,
          },
          {
            prop: "gr_status",
            operator: "equal",
            value: "Draft",
          },
        ],
      },
    ])
    .get();

  if (!resGR || resGR.data.length === 0) return [];

  console.log("checkExistingGR", resGR.data);
  return resGR.data;
};

const checkExistingPurchaseInvoice = async (poID) => {
  const resPI = await db
    .collection("purchase_invoice")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "po_id",
            operator: "in",
            value: poID,
          },
          {
            prop: "pi_status",
            operator: "equal",
            value: "Draft",
          },
        ],
      },
    ])
    .get();

  if (!resPI || resPI.data.length === 0) return [];

  return resPI.data;
};

const completePO = async (poID) => {
  try {
    await db.collection("purchase_order").doc(poID).update({
      po_status: "Completed",
    });
  } catch (error) {
    console.error("Error completing PO:", error);
    throw error;
  }
};

const deleteRelatedGR = async (existingGR) => {
  try {
    for (const gr of existingGR) {
      await db.collection("goods_receiving").doc(gr.id).update({
        is_deleted: 1,
      });
    }
  } catch {
    throw new Error("Error in deleting associated goods receiving.");
  }
};

const deleteRelatedPI = async (existingPI) => {
  try {
    for (const pi of existingPI) {
      await db.collection("purchase_invoice").doc(pi.id).update({
        is_deleted: 1,
      });
    }
  } catch {
    throw new Error("Error in deleting associated purchase invoice.");
  }
};

(async () => {
  try {
    const unCompletedListID = "custom_y9e0c53q";
    const allListID = "custom_6f0yz6lm";
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
      let purchaseOrderData = selectedRecords.filter(
        (item) => item.po_status === "Processing" || item.po_status === "Issued"
      );

      if (purchaseOrderData.length === 0) {
        this.$message.error(
          "Please select at least one processing or issued purchase order."
        );
        return;
      }

      // Check for Created GRs first - must be cancelled before force completion
      const purchaseOrderWithCreatedGR = [];
      const createdGrDataMap = new Map();

      for (const poItem of purchaseOrderData) {
        try {
          const createdGRResults = await db
            .collection("goods_receiving")
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  {
                    prop: "po_id",
                    operator: "in",
                    value: poItem.id,
                  },
                  {
                    prop: "gr_status",
                    operator: "equal",
                    value: "Created",
                  },
                ],
              },
            ])
            .get();

          if (createdGRResults.data && createdGRResults.data.length > 0) {
            createdGrDataMap.set(poItem.id, createdGRResults.data);
            purchaseOrderWithCreatedGR.push(poItem);
          }
        } catch (error) {
          console.error("Error querying Created GR:", error);
        }
      }

      if (purchaseOrderWithCreatedGR.length > 0) {
        const createdGrInfo = purchaseOrderWithCreatedGR.map((poItem) => {
          const grList = createdGrDataMap.get(poItem.id) || [];
          const grNumbers = grList.map((gr) => gr.gr_no).join(", ");
          return `PO: ${poItem.purchase_order_no} → GR: ${grNumbers}`;
        });

        await this.$alert(
          `These purchase orders have created goods receiving. <br> <strong>Purchase Order → Goods Receiving:</strong> <br>${createdGrInfo.join(
            "<br>"
          )} <br><br>Please cancel the goods receiving first.`,
          "Purchase Order with Created Goods Receiving",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        );

        const createdGrPOIds = purchaseOrderWithCreatedGR.map(
          (item) => item.id
        );
        purchaseOrderData = purchaseOrderData.filter(
          (item) => !createdGrPOIds.includes(item.id)
        );

        if (purchaseOrderData.length === 0) {
          return;
        }
      }

      // Check for existing GR/PI across all selected POs
      let allExistingGR = [];
      let allExistingPI = [];

      for (const poItem of purchaseOrderData) {
        const existingGR = await checkExistingGoodsReceiving(poItem.id);
        const existingPI = await checkExistingPurchaseInvoice(poItem.id);

        allExistingGR = allExistingGR.concat(existingGR);
        allExistingPI = allExistingPI.concat(existingPI);
      }

      // Handle draft GR/PI - ask for confirmation to delete
      if (allExistingGR.length > 0 || allExistingPI.length > 0) {
        const grInfo =
          allExistingGR.length > 0
            ? allExistingGR.map((gr) => gr.gr_no).join(", ")
            : "";
        const piInfo =
          allExistingPI.length > 0
            ? allExistingPI.map((pi) => pi.purchase_invoice_no).join(", ")
            : "";

        await this.$confirm(
          `${
            allExistingGR.length > 0
              ? `The selected purchase orders have existing goods receiving records in draft status: <br><strong>GR Numbers:</strong> ${grInfo}<br>Proceeding will delete all associated goods receiving records.<br><br>`
              : ""
          }${
            allExistingPI.length > 0
              ? `The selected purchase orders have existing purchase invoice records in draft status: <br><strong>PI Numbers:</strong> ${piInfo}<br>Proceeding will delete all associated purchase invoice records.<br><br>`
              : ""
          }<strong>Do you wish to continue?</strong>`,
          `Existing ${
            allExistingGR.length > 0 && allExistingPI.length > 0
              ? "GR and PI"
              : allExistingGR.length > 0
              ? "GR"
              : "PI"
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

        // Delete related GR and PI
        await deleteRelatedGR(allExistingGR);
        await deleteRelatedPI(allExistingPI);
      }

      // Final confirmation for force completion
      const purchaseOrderNumbers = purchaseOrderData.map(
        (item) => item.purchase_order_no
      );

      await this.$confirm(
        `You've selected ${
          purchaseOrderNumbers.length
        } purchase order(s) to force complete. <br> <strong>Purchase Order Numbers:</strong> <br>${purchaseOrderNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Purchase Order Force Completion",
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

      // Complete all selected purchase orders
      for (const poItem of purchaseOrderData) {
        await completePO(poItem.id);
      }

      this.$message.success(
        `Successfully completed ${purchaseOrderData.length} purchase order(s).`
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
