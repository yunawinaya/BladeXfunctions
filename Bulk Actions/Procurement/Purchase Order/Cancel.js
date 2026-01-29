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
        (item) => item.po_status === "Issued"
      );

      if (purchaseOrderData.length === 0) {
        this.$message.error(
          "Please select at least one issued purchase order."
        );
        return;
      }

      // Check for Created GRs first - must be cancelled before PO can be cancelled
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

      // Check for Received/Completed GRs - cannot cancel PO if processed
      const purchaseOrderWithProcessedGR = [];
      const processedGrDataMap = new Map();

      for (const poItem of purchaseOrderData) {
        try {
          const receivedGRResults = await db
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
                    value: "Received",
                  },
                ],
              },
            ])
            .get();

          const completedGRResults = await db
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
                    value: "Completed",
                  },
                ],
              },
            ])
            .get();

          const allProcessedGRs = [
            ...(receivedGRResults.data || []),
            ...(completedGRResults.data || []),
          ];

          if (allProcessedGRs.length > 0) {
            processedGrDataMap.set(poItem.id, allProcessedGRs);
            purchaseOrderWithProcessedGR.push(poItem);
          }
        } catch (error) {
          console.error("Error querying GR:", error);
        }
      }

      if (purchaseOrderWithProcessedGR.length > 0) {
        const processedGrInfo = purchaseOrderWithProcessedGR.map((poItem) => {
          const grList = processedGrDataMap.get(poItem.id) || [];
          const grNumbers = grList
            .map((gr) => `${gr.gr_no} (${gr.gr_status})`)
            .join(", ");
          return `PO: ${poItem.purchase_order_no} → GR: ${grNumbers}`;
        });

        await this.$alert(
          `These purchase orders have received/completed goods receiving. <br> <strong>Purchase Order → Goods Receiving:</strong> <br>${processedGrInfo.join(
            "<br>"
          )} <br><br>Cannot cancel purchase orders with processed goods receiving.`,
          "Purchase Order with Processed Goods Receiving",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        );

        const processedGrPOIds = purchaseOrderWithProcessedGR.map(
          (item) => item.id
        );
        purchaseOrderData = purchaseOrderData.filter(
          (item) => !processedGrPOIds.includes(item.id)
        );

        if (purchaseOrderData.length === 0) {
          return;
        }
      }

      const purchaseOrderWithInvoicing = [];
      const invoicedPiDataMap = new Map();

      for (const poItem of purchaseOrderData) {
        if (
          poItem.pi_status === "Partially Invoiced" ||
          poItem.pi_status === "Fully Invoiced"
        ) {
          try {
            const PIResults = await db
              .collection("purchase_invoice")
              .filter([
                {
                  prop: "po_id",
                  operator: "in",
                  value: poItem.id,
                },
              ])
              .get();

            if (PIResults.data && PIResults.data.length > 0) {
              invoicedPiDataMap.set(poItem.id, PIResults.data);
              purchaseOrderWithInvoicing.push(poItem);
            }
          } catch (error) {
            console.error("Error querying PI:", error);
          }
        }
      }

      if (purchaseOrderWithInvoicing.length > 0) {
        const invoicedPiInfo = purchaseOrderWithInvoicing.map((poItem) => {
          const piList = invoicedPiDataMap.get(poItem.id) || [];
          const piNumbers = piList
            .map((pi) => pi.purchase_invoice_no)
            .join(", ");
          return `PO: ${poItem.purchase_order_no} (${poItem.pi_status}) → PI: ${piNumbers}`;
        });

        await this.$alert(
          `These purchase orders are already invoiced. <br> <strong>Purchase Order → Purchase Invoice:</strong> <br>${invoicedPiInfo.join(
            "<br>"
          )} <br><br>Cannot cancel invoiced purchase orders.`,
          "Purchase Order Already Invoiced",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }
        );

        const invoicedPOIds = purchaseOrderWithInvoicing.map((item) => item.id);
        purchaseOrderData = purchaseOrderData.filter(
          (item) => !invoicedPOIds.includes(item.id)
        );

        if (purchaseOrderData.length === 0) {
          return;
        }
      }

      const grDataMap = new Map();
      const purchaseOrderwithDraftGR = [];

      for (const poItem of purchaseOrderData) {
        try {
          const GRResults = await db
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
                    value: "Draft",
                  },
                ],
              },
            ])
            .get();

          if (GRResults.data && GRResults.data.length > 0) {
            grDataMap.set(poItem.id, GRResults.data);
            purchaseOrderwithDraftGR.push(poItem);
          }
        } catch (error) {
          console.error("Error querying GR:", error);
        }
      }

      if (purchaseOrderwithDraftGR.length > 0) {
        const poAndGrInfo = purchaseOrderwithDraftGR.map((poItem) => {
          const grList = grDataMap.get(poItem.id) || [];
          const grNumbers = grList.map((gr) => gr.gr_no).join(", ");
          return `PO: ${poItem.purchase_order_no} → GR: ${grNumbers}`;
        });

        const result = await this.$confirm(
          `These purchase orders have draft goods receiving. <br> <strong>Purchase Order → Goods Receiving:</strong> <br>${poAndGrInfo.join(
            "<br>"
          )} <br><br>Do you wish to delete the goods receiving first?`,
          "Purchase Order with Draft Goods Receiving",
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
          for (const poItem of purchaseOrderwithDraftGR) {
            const grList = grDataMap.get(poItem.id) || [];
            for (const grItem of grList) {
              await db.collection("goods_receiving").doc(grItem.id).update({
                is_deleted: 1,
              });
            }
          }
        } else {
          const draftGRIds = purchaseOrderwithDraftGR.map((item) => item.id);
          purchaseOrderData = purchaseOrderData.filter(
            (item) => !draftGRIds.includes(item.id)
          );
        }

        if (purchaseOrderData.length === 0) {
          this.$message.info("No purchase orders to cancel.");
          return;
        }
      }

      const piDataMap = new Map();
      const purchaseOrderwithDraftPI = [];

      for (const poItem of purchaseOrderData) {
        try {
          const PIResults = await db
            .collection("purchase_invoice")
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
                    prop: "pi_status",
                    operator: "equal",
                    value: "Draft",
                  },
                ],
              },
            ])
            .get();

          if (PIResults.data && PIResults.data.length > 0) {
            piDataMap.set(poItem.id, PIResults.data);
            purchaseOrderwithDraftPI.push(poItem);
          }
        } catch (error) {
          console.error("Error querying PI:", error);
        }
      }

      if (purchaseOrderwithDraftPI.length > 0) {
        const poAndPiInfo = purchaseOrderwithDraftPI.map((poItem) => {
          const piList = piDataMap.get(poItem.id) || [];
          const piNumbers = piList
            .map((pi) => pi.purchase_invoice_no)
            .join(", ");
          return `PO: ${poItem.purchase_order_no} → PI: ${piNumbers}`;
        });

        const result = await this.$confirm(
          `These purchase orders have draft purchase invoice. <br> <strong>Purchase Order → Purchase Invoice:</strong> <br>${poAndPiInfo.join(
            "<br>"
          )} <br><br>Do you wish to delete the purchase invoice first?`,
          "Purchase Order with Draft Purchase Invoice",
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
          for (const poItem of purchaseOrderwithDraftPI) {
            const piList = piDataMap.get(poItem.id) || [];
            for (const piItem of piList) {
              await db.collection("purchase_invoice").doc(piItem.id).update({
                is_deleted: 1,
              });
            }
          }
        } else {
          const draftPIIds = purchaseOrderwithDraftPI.map((item) => item.id);
          purchaseOrderData = purchaseOrderData.filter(
            (item) => !draftPIIds.includes(item.id)
          );
        }

        if (purchaseOrderData.length === 0) {
          this.$message.info("No purchase orders to cancel.");
          return;
        }
      }

      const purchaseOrderNumbers = purchaseOrderData.map(
        (item) => item.purchase_order_no
      );

      await this.$confirm(
        `You've selected ${
          purchaseOrderNumbers.length
        } purchase order(s) to cancel. <br> <strong>Purchase Order Numbers:</strong> <br>${purchaseOrderNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Purchase Order Cancellation",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }
      ).catch(() => {
        throw new Error();
      });

      for (const poItem of purchaseOrderData) {
        const id = poItem.id;
        const purchase_order_no = poItem.purchase_order_no;
        const po_plant = poItem.po_plant.id;

        if (!id || !purchase_order_no) {
          console.error("Missing required fields:", {
            id,
            purchase_order_no,
            po_plant,
          });
          alert("Error: Missing required purchase order information.");
          continue;
        }

        const whereCondition = { purchase_order_number: purchase_order_no };
        if (po_plant) {
          whereCondition.plant_id = po_plant;
        }

        db.collection("on_order_purchase_order")
          .where(whereCondition)
          .get()
          .then((result) => {
            if (
              result &&
              result.data &&
              Array.isArray(result.data) &&
              result.data.length > 0
            ) {
              const updatePromises = result.data.map((record) => {
                if (record && record.id) {
                  return db
                    .collection("on_order_purchase_order")
                    .doc(record.id)
                    .update({ is_deleted: 1 });
                }
                return Promise.resolve();
              });
              return Promise.all(updatePromises);
            }
            return [];
          })
          .then(() => {
            return db.collection("purchase_order").doc(id).update({
              po_status: "Cancelled",
            });
          })
          .then(() => {
            return db
              .collection("purchase_order_2ukyuanr_sub")
              .where({ purchase_order_id: id })
              .update({
                line_status: "Cancelled",
              });
          })
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
