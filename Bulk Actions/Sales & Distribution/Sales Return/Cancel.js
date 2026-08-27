const checkExisitingSRR = async (selectedRecords) => {
  const srrNumberwithSR = new Set(); // Use Set to avoid duplicates

  await Promise.all(
    selectedRecords.map((srID) =>
      db
        .collection("sales_return_receiving")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "sr_id", operator: "in", value: srID.id },
              { prop: "srr_status", operator: "equals", value: "Draft" },
            ],
          },
        ])
        .get()
        .then((response) => {
          if (response.data[0]) {
            srrNumberwithSR.add(selectedRecords.sales_return_no);
          }
        }),
    ),
  );

  console.log("srr numbers with existing SR:", Array.from(srrNumberwithSR));
  return Array.from(srrNumberwithSR);
};

const updateGD = async (entry) => {
  try {
    const resGDLineData = await Promise.all(
      entry.table_sr.map(
        async (item) =>
          await db
            .collection("goods_delivery_fwii8mvb_sub")
            .doc(item.gd_line_id)
            .get(),
      ),
    );

    const gdLineItemData = resGDLineData.map((response) => response.data[0]);

    await Promise.all(
      entry.table_sr.map(async (item, index) => {
        await db
          .collection("goods_delivery_fwii8mvb_sub")
          .doc(item.gd_line_id)
          .update({
            return_qty:
              parseFloat(gdLineItemData[index].return_qty || 0) -
              parseFloat(item.expected_return_qty || 0),
          });
      }),
    );

    const resGD = await Promise.all(
      entry.gd_id.map(
        async (item) => await db.collection("goods_delivery").doc(item).get(),
      ),
    );

    const gdData = resGD.map((response) => response.data[0]);

    const updatedGD = await Promise.all(
      gdData.map(async (item, index) => {
        const updatedGDStatus = item.table_gd.some(
          (gdItem) => parseFloat(gdItem.return_qty || 0) > 0,
        )
          ? "Partially Returned"
          : "";

        return {
          id: item.id,
          sr_status: updatedGDStatus,
        };
      }),
    );

    await Promise.all(
      updatedGD.map(async (item) => {
        await db.collection("goods_delivery").doc(item.id).update({
          sr_status: item.sr_status,
        });
      }),
    );
  } catch (error) {
    throw new Error("Error updating Goods Delivery records." + error);
  }
};

(async () => {
  try {
    const unCompletedListID = "custom_sx3wmtii";
    const allListID = "custom_qnowgkx8";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted",
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID,
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      selectedRecords = selectedRecords.filter(
        (item) => item.sr_status === "Issued",
      );

      console.log("selectedRecords", selectedRecords);
      if (selectedRecords.length === 0) {
        this.$message.error("Please select at least one issued sales return.");
        return;
      }

      await this.$confirm(
        `You've selected ${
          selectedRecords.length
        } sales return(s) to cancel. <br> <strong>Sales Return Numbers:</strong> <br>${selectedRecords.sales_return_no.join(
          ", ",
        )} <br>Do you want to proceed?`,
        "Sales Return Cancellation",
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

      const existingSRRNumbers = await checkExisitingSRR(selectedRecords);

      // if has existing purchase invoice, pop dialog and reset gr
      if (existingSRRNumbers && existingSRRNumbers.length > 0) {
        this.$confirm(
          `${existingSRRNumbers.join(
            ", ",
          )} has existing Draft Sales Return Receiving. Proceed will delete all associated Sales Return Receiving.
          <br><br> <strong>Do you wish to continue?</strong>`,
          "Existing Sales Return Receiving(s) Detected",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: false,
          },
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          throw new Error();
        });
      }

      for (const sr of selectedRecords) {
        db.collection("sales_return")
          .doc(sr.id)
          .update({
            sr_status: "Cancelled",
          })
          .then(async () => {
            await updateGD(sr);
            this.refresh();
          })
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
