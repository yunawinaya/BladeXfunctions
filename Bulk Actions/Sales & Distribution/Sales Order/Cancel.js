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

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const pickingSetupResponse = await db
      .collection("picking_setup")
      .where({
        organization_id: organizationId,
        picking_required: 1,
      })
      .get();

    const isSOPP =
      pickingSetupResponse.data.length > 0 &&
      pickingSetupResponse.data[0].picking_after === "Sales Order";

    if (selectedRecords && selectedRecords.length > 0) {
      let salesOrderData = selectedRecords.filter(
        (item) => item.so_status === "Issued"
      );

      if (salesOrderData.length === 0) {
        this.$message.error("Please select at least one issued sales order.");
        return;
      }

      const collectionName = isSOPP ? "picking_plan" : "goods_delivery";

      const salesOrderWithCreatedGDorPP = [];
      const createdGdOrPpDataMap = new Map();

      for (const soItem of salesOrderData) {
        try {
          const GDorPPResults = await db
            .collection(collectionName)
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  {
                    prop: "so_id",
                    operator: "in",
                    value: soItem.id,
                  },
                  {
                    prop: isSOPP ? "to_status" : "gd_status",
                    operator: "equal",
                    value: "Created",
                  },
                ],
              },
            ])
            .get();

          if (GDorPPResults.data && GDorPPResults.data.length > 0) {
            createdGdOrPpDataMap.set(soItem.id, GDorPPResults.data);
            salesOrderWithCreatedGDorPP.push(soItem);
          }
        } catch (error) {
          console.error("Error querying GD:", error);
        }
      }

      if (salesOrderWithCreatedGDorPP.length > 0) {
        const createdGdOrPpInfo = salesOrderWithCreatedGDorPP.map((soItem) => {
          const docList = createdGdOrPpDataMap.get(soItem.id) || [];
          const documentNumbers = docList
            .map((doc) => (isSOPP ? doc.to_no : doc.delivery_no))
            .join(", ");
          return `SO: ${soItem.so_no} → ${
            isSOPP ? "PP" : "GD"
          }: ${documentNumbers}`;
        });

        const documentType = isSOPP ? "picking plan" : "goods delivery";
        const documentTypeTitle = isSOPP ? "Picking Plan" : "Goods Delivery";

        await this.$alert(
          `These sales orders have created ${documentType}. <br> <strong>Sales Order → ${documentTypeTitle}:</strong> <br>${createdGdOrPpInfo.join(
            "<br>"
          )} <br><br>Please cancel the ${documentType} first.`,
          `Sales Order with Created ${documentTypeTitle}`,
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        );

        const createdGdSOIds = salesOrderWithCreatedGDorPP.map(
          (item) => item.id
        );
        salesOrderData = salesOrderData.filter(
          (item) => !createdGdSOIds.includes(item.id)
        );

        if (salesOrderData.length === 0) {
          return;
        }
      }

      const salesOrderWithInvoicing = [];
      const invoicedSiDataMap = new Map();

      for (const soItem of salesOrderData) {
        if (
          soItem.si_status === "Partially Invoiced" ||
          soItem.si_status === "Fully Invoiced"
        ) {
          try {
            const SIResults = await db
              .collection("sales_invoice")
              .filter([
                {
                  prop: "so_id",
                  operator: "in",
                  value: soItem.id,
                },
              ])
              .get();

            if (SIResults.data && SIResults.data.length > 0) {
              invoicedSiDataMap.set(soItem.id, SIResults.data);
              salesOrderWithInvoicing.push(soItem);
            }
          } catch (error) {
            console.error("Error querying SI:", error);
          }
        }
      }

      if (salesOrderWithInvoicing.length > 0) {
        const invoicedSiInfo = salesOrderWithInvoicing.map((soItem) => {
          const siList = invoicedSiDataMap.get(soItem.id) || [];
          const siNumbers = siList.map((si) => si.sales_invoice_no).join(", ");
          return `SO: ${soItem.so_no} (${soItem.si_status}) → SI: ${siNumbers}`;
        });

        await this.$alert(
          `These sales orders are already invoiced. <br> <strong>Sales Order → Sales Invoice:</strong> <br>${invoicedSiInfo.join(
            "<br>"
          )} <br><br>Cannot cancel invoiced sales orders.`,
          "Sales Order Already Invoiced",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        );

        const invoicedSOIds = salesOrderWithInvoicing.map((item) => item.id);
        salesOrderData = salesOrderData.filter(
          (item) => !invoicedSOIds.includes(item.id)
        );

        if (salesOrderData.length === 0) {
          return;
        }
      }

      const gdOrPpDataMap = new Map();
      const salesOrderwithDraftGDorPP = [];

      for (const soItem of salesOrderData) {
        try {
          const GDorPPResults = await db
            .collection(collectionName)
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  {
                    prop: "so_id",
                    operator: "in",
                    value: soItem.id,
                  },
                  {
                    prop: isSOPP ? "to_status" : "gd_status",
                    operator: "equal",
                    value: "Draft",
                  },
                ],
              },
            ])
            .get();

          if (GDorPPResults.data && GDorPPResults.data.length > 0) {
            gdOrPpDataMap.set(soItem.id, GDorPPResults.data);
            salesOrderwithDraftGDorPP.push(soItem);
          }
        } catch (error) {
          console.error(`Error querying ${collectionName}:`, error);
        }
      }

      if (salesOrderwithDraftGDorPP.length > 0) {
        const soAndGdOrPpInfo = salesOrderwithDraftGDorPP.map((soItem) => {
          const gdOrPpList = gdOrPpDataMap.get(soItem.id) || [];
          const documentNumbers = gdOrPpList
            .map((doc) => (isSOPP ? doc.to_no : doc.delivery_no))
            .join(", ");
          return `SO: ${soItem.so_no} → ${
            isSOPP ? "PP" : "GD"
          }: ${documentNumbers}`;
        });

        const documentType = isSOPP ? "picking plan" : "goods delivery";
        const documentTypeTitle = isSOPP ? "Picking Plan" : "Goods Delivery";

        const result = await this.$confirm(
          `These sales orders have draft ${documentType}. <br> <strong>Sales Order → ${documentTypeTitle}:</strong> <br>${soAndGdOrPpInfo.join(
            "<br>"
          )} <br><br>Do you wish to delete the ${documentType} first?`,
          `Sales Order with Draft ${documentTypeTitle}`,
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {
          return null;
        });

        if (result === "confirm") {
          for (const soItem of salesOrderwithDraftGDorPP) {
            const docList = gdOrPpDataMap.get(soItem.id) || [];
            for (const docItem of docList) {
              await db.collection(collectionName).doc(docItem.id).update({
                is_deleted: 1,
              });
            }
          }
        } else {
          const draftDocIds = salesOrderwithDraftGDorPP.map((item) => item.id);
          salesOrderData = salesOrderData.filter(
            (item) => !draftDocIds.includes(item.id)
          );
        }

        if (salesOrderData.length === 0) {
          this.$message.info("No sales orders to cancel.");
          return;
        }
      }

      const siDataMap = new Map();
      const salesOrderwithDraftSI = [];

      for (const soItem of salesOrderData) {
        try {
          const SIResults = await db
            .collection("sales_invoice")
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  {
                    prop: "so_id",
                    operator: "in",
                    value: soItem.id,
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

          if (SIResults.data && SIResults.data.length > 0) {
            siDataMap.set(soItem.id, SIResults.data);
            salesOrderwithDraftSI.push(soItem);
          }
        } catch (error) {
          console.error("Error querying SI:", error);
        }
      }

      if (salesOrderwithDraftSI.length > 0) {
        const soAndSiInfo = salesOrderwithDraftSI.map((soItem) => {
          const siList = siDataMap.get(soItem.id) || [];
          const siNumbers = siList.map((si) => si.sales_invoice_no).join(", ");
          return `SO: ${soItem.so_no} → SI: ${siNumbers}`;
        });

        const result = await this.$confirm(
          `These sales orders have draft sales invoice. <br> <strong>Sales Order → Sales Invoice:</strong> <br>${soAndSiInfo.join(
            "<br>"
          )} <br><br>Do you wish to delete the sales invoice first?`,
          "Sales Order with Draft Sales Invoice",
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {
          return null;
        });

        if (result === "confirm") {
          for (const soItem of salesOrderwithDraftSI) {
            const siList = siDataMap.get(soItem.id) || [];
            for (const siItem of siList) {
              await db.collection("sales_invoice").doc(siItem.id).update({
                is_deleted: 1,
              });
            }
          }
        } else {
          const draftSIIds = salesOrderwithDraftSI.map((item) => item.id);
          salesOrderData = salesOrderData.filter(
            (item) => !draftSIIds.includes(item.id)
          );
        }

        if (salesOrderData.length === 0) {
          this.$message.info("No sales orders to cancel.");
          return;
        }
      }

      const salesOrderNumbers = salesOrderData.map((item) => item.so_no);

      await this.$confirm(
        `You've selected ${
          salesOrderNumbers.length
        } sales order(s) to cancel. <br> <strong>Sales Order Numbers:</strong> <br>${salesOrderNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Sales Order Cancellation",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }
      ).catch(() => {
        throw new Error();
      });

      for (const soItem of salesOrderData) {
        const id = soItem.id;
        db.collection("sales_order")
          .doc(id)
          .update({
            so_status: "Cancelled",
          })
          .then(() =>
            db
              .collection("sales_order_axszx8cj_sub")
              .where({ sales_order_id: id })
              .update({
                line_status: "Cancelled",
              })
          )
          .then(() => this.refresh())
          .catch((error) => {
            console.error("Error in cancellation process:", error);
            alert("An error occurred during cancellation. Please try again.");
          });
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
