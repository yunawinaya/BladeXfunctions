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
  const uniquePlants = new Set(selectedRecords.map((to) => to.plant_id.id));
  const allSamePlant = uniquePlants.size === 1;

  if (!allSamePlant) {
    this.$alert(
      "All selected picking plan must be from the same plant to create a single picking.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    throw new Error("All selected picking plan must be from the same plant.");
  }

  const packingRequired = await getPackingSetup(
    selectedRecords[0].organization_id,
  );

  if (packingRequired === 1) {
    const uniqueCustomers = new Set(
      selectedRecords.map((to) => to.customer_id),
    );
    const allSameCustomer = uniqueCustomers.size === 1;

    if (!allSameCustomer) {
      this.$alert(
        "All selected picking plan must be from the same customer to create a single picking due to packing requirement.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );
      throw new Error(
        "All selected picking plan must be from the same customer due to packing requirement.",
      );
    }
  }

  const createdPickings = await db
    .collection("transfer_order")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "to_no",
            operator: "in",
            value: selectedRecords.map((pp) => pp.id),
          },
          {
            prop: "to_status",
            operator: "equal",
            value: "Created",
          },
        ],
      },
    ])
    .get();

  if (createdPickings.data.length > 0) {
    this.$alert(
      "Some picking plan records are already converted to picking and still in Created status. Please complete the picking first before converting another picking.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    throw new Error(
      "Some picking plan records are already converted to picking.",
    );
  }

  this.showLoading("Converting to Picking...");
  await this.runWorkflow(
    "2027285718294261761",
    {
      pp_ids: selectedRecords.map((pp) => pp.id),
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
    },
  );
};

(async () => {
  try {
    const allListID = "picking_plan_table";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      const cancelledRecords = selectedRecords.filter(
        (item) => item.to_status === "Cancelled",
      );

      if (cancelledRecords.length > 0) {
        await this.$alert(
          `Cannot convert cancelled picking plan records:<br><br>${cancelledRecords
            .map((item) => item.to_no)
            .join("<br>")}`,
          "Cancelled Records Selected",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "error",
          },
        );
        return;
      }

      selectedRecords = selectedRecords.filter((item) =>
        item.table_to.some((toItem) => toItem.picking_status !== "Completed"),
      );

      if (selectedRecords.length === 0) {
        await this.$alert(
          "No selected records are available for conversion. Please select records with picking status 'Not Created' or 'Created' or 'In Progress'.",
          "No Records to Convert",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "warning",
          },
        );
        return;
      }

      // Filter out records that are not "Not Created"
      await this.$confirm(
        `Only these picking plan records available for conversion. Proceed?<br><br>
  <strong>Selected Records:</strong><br> ${selectedRecords
    .map((item) => {
      const totalItems = item.table_to.length;
      const pickableItems = item.table_to.filter(
        (toItem) => toItem.picking_status !== "Completed",
      ).length;
      return `${item.to_no} (${pickableItems}/${totalItems} items)`;
    })
    .join("<br>")}`,
        "Confirm Conversion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        },
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
