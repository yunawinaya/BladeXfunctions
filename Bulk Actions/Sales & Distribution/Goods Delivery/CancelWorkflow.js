const runGDWorkflow = async (data) => {
  return new Promise((resolve, reject) => {
    this.runWorkflow(
      "2017151544868491265",
      {
        allData: data,
        saveAs: "Cancelled",
        pageStatus: "Edit",
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

(async () => {
  try {
    this.showLoading();
    const allListID = "custom_ezwb0qqp";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      let goodsDeliveryData = selectedRecords.filter(
        (item) => item.gd_status === "Created",
      );

      if (goodsDeliveryData.length === 0) {
        this.$message.error(
          "Please select at least one created goods delivery.",
        );
        throw new Error();
      }

      const goodsDeliveryNumbers = goodsDeliveryData.map(
        (item) => item.delivery_no,
      );

      await this.$confirm(
        `You've selected ${
          goodsDeliveryNumbers.length
        } goods delivery(s) to cancel. <br> <strong>Goods Delivery Numbers:</strong> <br>${goodsDeliveryNumbers.join(
          ", ",
        )} <br>Do you want to proceed?`,
        "Goods Delivery Cancellation",
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

      for (const gdItem of goodsDeliveryData) {
        const id = gdItem.id;

        const data = await db.collection("goods_delivery").doc(id).get();

        try {
          const workflowResult = await runGDWorkflow(data.data[0]);

          if (!workflowResult || !workflowResult.data) {
            results.push({
              delivery_no: gdItem.delivery_no,
              success: false,
              error: "No response from workflow",
            });
            continue;
          }

          const resultCode = workflowResult.data.code;

          // Handle 400 - General error
          if (
            resultCode === "400" ||
            resultCode === 400 ||
            workflowResult.data.success === false
          ) {
            const errorMessage =
              workflowResult.data.msg ||
              workflowResult.data.message ||
              "Failed to cancel Goods Delivery";
            results.push({
              delivery_no: gdItem.delivery_no,
              success: false,
              error: errorMessage,
            });
            continue;
          }

          // Handle success
          if (
            resultCode === "200" ||
            resultCode === 200 ||
            workflowResult.data.success === true
          ) {
            // Handle picking status update
            if (gdItem.picking_status) {
              const pickingFilter = new Filter().in("gd_no", [id]).build();

              const resPicking = await db
                .collection("transfer_order")
                .filter(pickingFilter)
                .get();

              if (resPicking && resPicking.data.length > 0) {
                console.log("resPicking", resPicking);
                const pickingList = resPicking.data;

                for (const pickingData of pickingList) {
                  for (const pickingItem of pickingData.table_picking_items) {
                    if (pickingItem.gd_id === id) {
                      pickingItem.line_status = "Cancelled";
                    }
                  }

                  const isAllGDCancelled =
                    pickingData.table_picking_items.every(
                      (item) => item.line_status === "Cancelled",
                    );

                  if (isAllGDCancelled) {
                    pickingData.to_status = "Cancelled";
                  }

                  console.log("pickingData", pickingData);

                  await db
                    .collection("transfer_order")
                    .doc(pickingData.id)
                    .update({
                      table_picking_items: pickingData.table_picking_items,
                      to_status: pickingData.to_status,
                    });
                }
              }
            }

            results.push({
              delivery_no: gdItem.delivery_no,
              success: true,
            });
          } else {
            results.push({
              delivery_no: gdItem.delivery_no,
              success: false,
              error: "Unknown workflow status",
            });
          }
        } catch (error) {
          results.push({
            delivery_no: gdItem.delivery_no,
            success: false,
            error: error.message || "Failed to cancel",
          });
        }
      }

      // Show summary
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      if (failCount > 0) {
        const failedItems = results
          .filter((r) => !r.success)
          .map((r) => `${r.delivery_no}: ${r.error}`)
          .join("<br>");
        this.$message.error(
          `${successCount} succeeded, ${failCount} failed:<br>${failedItems}`,
        );
      } else {
        this.$message.success(
          `All ${successCount} Goods Delivery cancelled successfully`,
        );
      }

      this.hideLoading();
      this.refresh();
    } else {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
