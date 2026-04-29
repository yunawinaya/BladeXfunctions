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

const isFullPickingEnabled = async (organizationId) => {
  try {
    const setupData = await db
      .collection("picking_setup")
      .where({ organization_id: organizationId })
      .get();
    return setupData?.data?.[0]?.allow_full_picking === 1;
  } catch (error) {
    console.error("Error reading allow_full_picking:", error);
    return false;
  }
};

// Sum qty_to_pick across non-terminal Pickings, keyed by gd_line_id.
const buildInFlightQtyMap = async (gdIds) => {
  const inFlight = {};
  if (!Array.isArray(gdIds) || gdIds.length === 0) return inFlight;

  await Promise.all(
    gdIds.map(async (gdId) => {
      try {
        const toResult = await db
          .collection("transfer_order")
          .where({ gd_no: gdId })
          .get();
        for (const to of toResult?.data || []) {
          if (to.to_status === "Completed" || to.to_status === "Cancelled") {
            continue;
          }
          for (const item of to.table_picking_items || []) {
            if (!item.gd_line_id) continue;
            const qty = parseFloat(item.qty_to_pick || 0);
            inFlight[item.gd_line_id] =
              (inFlight[item.gd_line_id] || 0) + qty;
          }
        }
      } catch (err) {
        console.error(`Error fetching in-flight TOs for gd ${gdId}:`, err);
      }
    }),
  );

  return inFlight;
};

const isLinePickable = (line, fullPickingEnabled, inFlightMap) => {
  if (fullPickingEnabled) {
    const inFlight = inFlightMap?.[line.id] || 0;
    const remaining =
      (line.gd_qty || 0) - (line.picked_qty || 0) - inFlight;
    return (
      remaining > 0 &&
      line.picking_status !== "Completed" &&
      line.picking_status !== "Cancelled"
    );
  }
  return line.picking_status === "Not Created";
};

const handlePicking = async (selectedRecords) => {
  const uniquePlants = new Set(selectedRecords.map((gd) => gd.plant_id.id));
  const allSamePlant = uniquePlants.size === 1;

  if (!allSamePlant) {
    this.$alert(
      "All selected goods delivery lines must be from the same plant to create a single picking.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    throw new Error(
      "All selected goods delivery lines must be from the same plant.",
    );
  }

  const packingRequired = await getPackingSetup(
    selectedRecords[0].organization_id,
  );

  if (packingRequired === 1) {
    const uniqueCustomers = new Set(
      selectedRecords.map((gd) => gd.customer_id),
    );
    const allSameCustomer = uniqueCustomers.size === 1;

    if (!allSameCustomer) {
      this.$alert(
        "All selected goods delivery lines must be from the same customer to create a single picking due to packing requirement.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
        },
      );
      throw new Error(
        "All selected goods delivery lines must be from the same customer due to packing requirement.",
      );
    }
  }

  this.showLoading("Converting to Picking...");
  await this.runWorkflow(
    "1986287276094935041",
    {
      gd_line_id: selectedRecords.map((gd) => gd.id),
      plant_id: selectedRecords[0].plant_id.id,
    },
    async (res) => {
      this.hideLoading();
      const pickingData = res.data.data;
      await this.toView({
        target: "1986287276094935041",
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
    const detaliedListID = "custom_5alercn9";

    let selectedRecords;

    selectedRecords = this.getComponent(detaliedListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      const fullPickingEnabled = await isFullPickingEnabled(
        selectedRecords[0].organization_id,
      );

      const gdIds = fullPickingEnabled
        ? [
            ...new Set(
              selectedRecords
                .map(
                  (line) =>
                    line.goods_delivery_id?.id || line.goods_delivery_id,
                )
                .filter(Boolean),
            ),
          ]
        : [];
      const inFlightMap = fullPickingEnabled
        ? await buildInFlightQtyMap(gdIds)
        : {};

      selectedRecords = selectedRecords.filter((line) =>
        isLinePickable(line, fullPickingEnabled, inFlightMap),
      );

      if (selectedRecords.length === 0) {
        await this.$alert(
          fullPickingEnabled
            ? "No selected lines have remaining quantity to pick (after accounting for non-Completed Pickings already in flight)."
            : "No selected records are available for conversion. Please select records with picking status 'Not Created'.",
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
        `Only these goods delivery records available for conversion. Proceed?<br><br>
        <strong>Selected Records:</strong><br> ${selectedRecords
          .map(
            (item) =>
              item.goods_delivery_id.delivery_no + " Line #" + item.line_index,
          )
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
        await this.getComponent(detaliedListID)?.$refs.crud.clearSelection();
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
