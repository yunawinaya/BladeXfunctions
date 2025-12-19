const getPackingSetup = async (organizationId) => {
  try {
    const packingData = await db
      .collection("packing_setup")
      .where({ organization_id: organizationId })
      .get();

    if (!packingData.data || packingData.data.length === 0) {
      return 0;
    }

    return packingData.data[0].packing_required;
  } catch (error) {
    console.error("Error in getPackingSetup:", error);
    return 0;
  }
};

const handlePicking = async (selectedRecords) => {
  const uniquePlants = new Set(selectedRecords.map((gd) => gd.plant_id.id));
  const allSamePlant = uniquePlants.size === 1;

  if (!allSamePlant) {
    this.$alert(
      "All selected goods deliveries must be from the same plant to create a single picking.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );
    throw new Error(
      "All selected goods deliveries must be from the same plant."
    );
  }

  const packingRequired = await getPackingSetup(
    selectedRecords[0].organization_id
  );

  if (packingRequired === 1) {
    const uniqueCustomers = new Set(
      selectedRecords.map((gd) => gd.customer_id.id)
    );
    const allSameCustomer = uniqueCustomers.size === 1;

    if (!allSameCustomer) {
      this.$alert(
        "All selected goods deliveries must be from the same customer to create a single picking due to packing requirement.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        }
      );
      throw new Error(
        "All selected goods deliveries must be from the same customer due to packing requirement."
      );
    }
  }

  this.showLoading("Converting to Picking...");
  await this.runWorkflow(
    "1986262284472963073",
    {
      gd_ids: selectedRecords.map((gd) => gd.id),
      plant_id: selectedRecords[0].plant_id.id,
    },
    async (res) => {
      this.hideLoading();
      const pickingData = res.data.data;
      await this.toView({
        target: "1935556443668959233",
        type: "add",
        data: { ...pickingData },
        position: "rtl",
        mode: "dialog",
        width: "80%",
        title: "Add",
      });
    },
    (err) => {
      this.hideLoading();
      throw err;
    }
  );
};

(async () => {
  try {
    const allListID = "custom_ezwb0qqp";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      selectedRecords = selectedRecords.filter((item) =>
        item.table_gd.some((gdItem) => gdItem.picking_status === "Not Created")
      );

      if (selectedRecords.length === 0) {
        await this.$alert(
          "No selected records are available for conversion. Please select records with picking status 'Not Created' or 'Created' or 'In Progress'.",
          "No Records to Convert",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "warning",
          }
        );
        return;
      }

      // Filter out records that are not "Not Created"
      await this.$confirm(
        `Only these goods delivery records available for conversion. Proceed?<br><br>
  <strong>Selected Records:</strong><br> ${selectedRecords
    .map((item) => {
      const totalItems = item.table_gd.length;
      const pickableItems = item.table_gd.filter(
        (gdItem) => gdItem.picking_status === "Not Created"
      ).length;
      return `${item.delivery_no} (${pickableItems}/${totalItems} items)`;
    })
    .join("<br>")}`,
        "Confirm Conversion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      if (selectedRecords.length > 0) {
        await handlePicking(selectedRecords);
        await this.getComponent(allListID)?.$refs.crud.clearSelection();
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
