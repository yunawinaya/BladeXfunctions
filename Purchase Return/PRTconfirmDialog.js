(async () => {
  const data = this.getValues();
  const temporaryData = data.confirm_inventory.table_item_balance || [];
  const huData = data.confirm_inventory.table_hu || [];
  const rowIndex = data.confirm_inventory.row_index;
  const returnQty = data.confirm_inventory.received_qty;
  let isValid = true;

  // Get UOM information (material_uom is not a PRT dialog field; defaults to PCS)
  const materialUOMid = data.confirm_inventory.material_uom;
  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: materialUOMid })
    .get()
    .then((res) => res.data[0]?.uom_name || "PCS");

  // Existing per-row loose validation (set by the return_quantity validator)
  const allValid = temporaryData.every((item, idx) => {
    const valid =
      window.validationState && window.validationState[idx] !== false;
    console.log(`Row ${idx} validation: ${valid}`);
    return valid;
  });

  if (!allValid) {
    console.log("Validation failed, canceling confirm");
    return;
  }

  // HU item rows the user actually wants to return
  const filteredHuData = huData.filter(
    (item) =>
      item.row_type === "item" && parseFloat(item.return_quantity || 0) > 0,
  );

  // Validate HU rows: return_quantity must not exceed available item_quantity.
  // HU items are always treated as Unrestricted, so no category check applies.
  for (const huItem of filteredHuData) {
    const rq = parseFloat(huItem.return_quantity || 0);
    const availableQty = parseFloat(huItem.item_quantity || 0);
    if (rq > availableQty) {
      const huHeader = huData.find(
        (row) =>
          row.row_type === "header" &&
          row.handling_unit_id === huItem.handling_unit_id,
      );
      const huName = huHeader?.handling_no || huItem.handling_unit_id;
      this.$message.error(
        `HU ${huName}: return quantity (${rq}) exceeds available (${availableQty}).`,
      );
      return;
    }
  }

  // Loose total (and ensure every picked loose row has a category)
  const totalLooseQty = temporaryData.reduce((sum, item) => {
    const qty = item.return_quantity || item.prt_quantity || 0;
    if (qty > 0 && (item.inventory_category || null) === null) {
      isValid = false;
    }
    return sum + (qty || 0);
  }, 0);

  if (!isValid) {
    this.$message.error("Invalid category type");
    return;
  }

  const totalHuQty = filteredHuData.reduce(
    (sum, item) => sum + (parseFloat(item.return_quantity) || 0),
    0,
  );
  const totalCombined = totalLooseQty + totalHuQty;

  if (totalCombined > returnQty) {
    this.$message.error("Total return quantity cannot exceed return quantity.");
    return;
  }

  // Loose rows to persist (unchanged shape — full balance record)
  const filteredLoose = temporaryData.filter((item) => {
    const qty = item.return_quantity || item.prt_quantity || 0;
    return qty !== null && qty !== undefined && qty !== 0;
  });

  // HU rows -> balance-shape temp_qty_data entries. handling_unit_id marks them
  // as HU-sourced for the future Save pass; category is always "Unrestricted".
  const huAsBalanceRows = filteredHuData.map((huItem) => ({
    material_id: huItem.material_id,
    location_id: huItem.location_id,
    storage_location_id: huItem.storage_location_id || null,
    batch_id: huItem.batch_id || null,
    balance_id: huItem.balance_id || "",
    return_quantity: parseFloat(huItem.return_quantity) || 0,
    category_balance: parseFloat(huItem.item_quantity) || 0,
    inventory_category: "Unrestricted",
    handling_unit_id: huItem.handling_unit_id,
    plant_id: data.plant_id,
    organization_id: data.organization_id,
    is_deleted: 0,
    expired_date: huItem.expired_date || null,
    manufacturing_date: huItem.manufacturing_date || null,
    remarks: "",
  }));

  // ============= SUMMARY =============

  const categoryMap = {
    Blocked: "BLK",
    Reserved: "RES",
    Unrestricted: "UNR",
    "Quality Inspection": "QIP",
    "In Transit": "INT",
  };

  const formatLooseDetails = async (filteredData) => {
    if (filteredData.length === 0) return "";

    const locationIds = [
      ...new Set(filteredData.map((item) => item.location_id)),
    ];
    const batchIds = [
      ...new Set(
        filteredData
          .map((item) => item.batch_id)
          .filter((batchId) => batchId != null && batchId !== ""),
      ),
    ];

    const locationPromises = locationIds.map(async (locationId) => {
      try {
        const resBinLocation = await db
          .collection("bin_location")
          .where({ id: locationId })
          .get();
        return {
          id: locationId,
          name:
            resBinLocation.data?.[0]?.bin_location_combine ||
            `Location ID: ${locationId}`,
        };
      } catch (error) {
        console.error(`Error fetching location ${locationId}:`, error);
        return { id: locationId, name: `${locationId} (Error)` };
      }
    });

    const batchPromises = batchIds.map(async (batchId) => {
      try {
        const resBatch = await db
          .collection("batch")
          .where({ id: batchId })
          .get();
        return {
          id: batchId,
          name: resBatch.data?.[0]?.batch_number || `Batch ID: ${batchId}`,
        };
      } catch (error) {
        console.error(`Error fetching batch ${batchId}:`, error);
        return { id: batchId, name: `${batchId} (Error)` };
      }
    });

    const [locations, batches] = await Promise.all([
      Promise.all(locationPromises),
      Promise.all(batchPromises),
    ]);

    const locationMap = locations.reduce((map, loc) => {
      map[loc.id] = loc.name;
      return map;
    }, {});
    const batchMap = batches.reduce((map, batch) => {
      map[batch.id] = batch.name;
      return map;
    }, {});

    return filteredData
      .map((item, index) => {
        const locationName = locationMap[item.location_id] || item.location_id;
        const qty = item.return_quantity || item.prt_quantity || 0;
        const categoryAbbr =
          categoryMap[item.inventory_category] ||
          categoryMap[item.category] ||
          item.inventory_category ||
          item.category ||
          "";

        let itemDetail = `${
          index + 1
        }. ${locationName}: ${qty} ${gdUOM} (${categoryAbbr})`;

        if (item.serial_number) {
          itemDetail += `\n[Serial: ${item.serial_number}]`;
        }
        if (item.batch_id) {
          const batchName = batchMap[item.batch_id] || item.batch_id;
          itemDetail += `\n[${batchName}]`;
        }
        if (item.remarks && item.remarks.trim() !== "") {
          itemDetail += `\n[Remarks: ${item.remarks.trim()}]`;
        }
        return itemDetail;
      })
      .join("\n");
  };

  const formatHuDetails = async (filteredHuList) => {
    if (filteredHuList.length === 0) return "";

    const batchIds = [
      ...new Set(
        filteredHuList
          .map((item) => item.batch_id)
          .filter((batchId) => batchId != null && batchId !== ""),
      ),
    ];

    const batchPromises = batchIds.map(async (batchId) => {
      try {
        const resBatch = await db
          .collection("batch")
          .where({ id: batchId })
          .get();
        return {
          id: batchId,
          name: resBatch.data?.[0]?.batch_number || `Batch ID: ${batchId}`,
        };
      } catch (error) {
        console.error(`Error fetching batch ${batchId}:`, error);
        return { id: batchId, name: `${batchId} (Error)` };
      }
    });

    const batches = await Promise.all(batchPromises);
    const batchMap = batches.reduce((map, batch) => {
      map[batch.id] = batch.name;
      return map;
    }, {});

    return filteredHuList
      .map((item, index) => {
        const huHeader = huData.find(
          (row) =>
            row.row_type === "header" &&
            row.handling_unit_id === item.handling_unit_id,
        );
        const huName = huHeader?.handling_no || item.handling_unit_id;
        let detail = `${index + 1}. ${huName}: ${
          item.return_quantity
        } ${gdUOM}`;
        if (item.batch_id) {
          const batchName = batchMap[item.batch_id] || item.batch_id;
          detail += `\n   [Batch: ${batchName}]`;
        }
        return detail;
      })
      .join("\n");
  };

  const hasHu = filteredHuData.length > 0;
  const hasLoose = filteredLoose.length > 0;
  const looseDetails = await formatLooseDetails(filteredLoose);

  let formattedString;
  if (hasHu && hasLoose) {
    formattedString = `Total: ${totalCombined} ${gdUOM}\n\nLOOSE STOCK:\n${looseDetails}\n\nHANDLING UNIT:\n${await formatHuDetails(
      filteredHuData,
    )}`;
  } else if (hasHu) {
    formattedString = `Total: ${totalHuQty} ${gdUOM}\n\nHANDLING UNIT:\n${await formatHuDetails(
      filteredHuData,
    )}`;
  } else {
    formattedString = `Total: ${totalLooseQty} ${gdUOM}\n\nDETAILS:\n${looseDetails}`;
  }

  // ============= PERSIST =============

  // temp_qty_data carries loose + HU rows; HU rows are distinguishable via
  // handling_unit_id. temp_hu_data carries the raw HU table rows so the dialog
  // can re-hydrate return_quantity on next open.
  const combinedTempQty = [...filteredLoose, ...huAsBalanceRows];

  this.setData({
    [`table_prt.${rowIndex}.temp_qty_data`]: JSON.stringify(combinedTempQty),
    [`table_prt.${rowIndex}.temp_hu_data`]: JSON.stringify(filteredHuData),
    [`table_prt.${rowIndex}.return_summary`]: formattedString,
    [`table_prt.${rowIndex}.return_quantity`]: totalCombined,
  });

  this.setData({
    [`confirm_inventory.table_item_balance`]: [],
    [`confirm_inventory.table_hu`]: [],
  });

  this.closeDialog("confirm_inventory");
})();
