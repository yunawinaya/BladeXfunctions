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
        (item) => item.so_status === "Issued"
      );

      if (salesOrderData.length === 0) {
        this.$message.error("Please select at least one issued sales order.");
        return;
      }

      const salesOrderWithCreatedGD = [];
      const createdGdDataMap = new Map();

      for (const soItem of salesOrderData) {
        try {
          const GDResults = await db
            .collection("goods_delivery")
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
                    prop: "gd_status",
                    operator: "equal",
                    value: "Created",
                  },
                ],
              },
            ])
            .get();

          if (GDResults.data && GDResults.data.length > 0) {
            createdGdDataMap.set(soItem.id, GDResults.data);
            salesOrderWithCreatedGD.push(soItem);
          }
        } catch (error) {
          console.error("Error querying GD:", error);
        }
      }

      if (salesOrderWithCreatedGD.length > 0) {
        const createdGdInfo = salesOrderWithCreatedGD.map((soItem) => {
          const gdList = createdGdDataMap.get(soItem.id) || [];
          const gdNumbers = gdList.map((gd) => gd.delivery_no).join(", ");
          return `SO: ${soItem.so_no} → GD: ${gdNumbers}`;
        });

        await this.$alert(
          `These sales orders have created goods delivery. <br> <strong>Sales Order → Goods Delivery:</strong> <br>${createdGdInfo.join(
            "<br>"
          )} <br><br>Please cancel the goods delivery first.`,
          "Sales Order with Created Goods Delivery",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        );

        const createdGdSOIds = salesOrderWithCreatedGD.map((item) => item.id);
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

      const gdDataMap = new Map();
      const salesOrderwithDraftGD = [];

      for (const soItem of salesOrderData) {
        try {
          const GDResults = await db
            .collection("goods_delivery")
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
                    prop: "gd_status",
                    operator: "equal",
                    value: "Draft",
                  },
                ],
              },
            ])
            .get();

          if (GDResults.data && GDResults.data.length > 0) {
            gdDataMap.set(soItem.id, GDResults.data);
            salesOrderwithDraftGD.push(soItem);
          }
        } catch (error) {
          console.error("Error querying GD:", error);
        }
      }

      if (salesOrderwithDraftGD.length > 0) {
        const soAndGdInfo = salesOrderwithDraftGD.map((soItem) => {
          const gdList = gdDataMap.get(soItem.id) || [];
          const gdNumbers = gdList.map((gd) => gd.delivery_no).join(", ");
          return `SO: ${soItem.so_no} → GD: ${gdNumbers}`;
        });

        const result = await this.$confirm(
          `These sales orders have draft goods delivery. <br> <strong>Sales Order → Goods Delivery:</strong> <br>${soAndGdInfo.join(
            "<br>"
          )} <br><br>Do you wish to delete the goods delivery first?`,
          "Sales Order with Draft Goods Delivery",
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
          for (const soItem of salesOrderwithDraftGD) {
            const gdList = gdDataMap.get(soItem.id) || [];
            for (const gdItem of gdList) {
              await db.collection("goods_delivery").doc(gdItem.id).update({
                is_deleted: 1,
              });
            }
          }
        } else {
          const draftGDIds = salesOrderwithDraftGD.map((item) => item.id);
          salesOrderData = salesOrderData.filter(
            (item) => !draftGDIds.includes(item.id)
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
