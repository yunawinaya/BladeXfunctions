(async () => {
  const allData = this.getValues();
  const temporaryData = allData.sm_item_balance.table_item_balance;
  const huData = allData.sm_item_balance.table_hu || [];
  const rowIndex = allData.sm_item_balance.row_index;
  const quantityUOM = allData.stock_movement[rowIndex].quantity_uom;
  const selectedUOM = allData.sm_item_balance.material_uom;

  let isValid = true;

  const gdUOM = await db
    .collection("unit_of_measurement")
    .where({ id: quantityUOM })
    .get()
    .then((res) => res.data[0]?.uom_name || "");

  const materialId = allData.stock_movement[rowIndex].item_selection;
  let itemData = null;
  try {
    const itemResponse = await db
      .collection("Item")
      .where({ id: materialId })
      .get();
    itemData = itemResponse.data[0];
  } catch (error) {
    console.error("Error fetching item data:", error);
  }

  let processedTemporaryData = temporaryData;
  let processedHuData = huData;

  if (selectedUOM !== quantityUOM && itemData) {
    const tableUOMConversion = itemData.table_uom_conversion;
    const baseUOM = itemData.based_uom;

    const convertQuantityFromTo = (
      value,
      table_uom_conversion,
      fromUOM,
      toUOM,
      baseUOM,
    ) => {
      if (!value || fromUOM === toUOM) return value;

      let baseQty = value;
      if (fromUOM !== baseUOM) {
        const fromConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === fromUOM,
        );
        if (fromConversion && fromConversion.base_qty) {
          baseQty = value * fromConversion.base_qty;
        }
      }

      if (toUOM !== baseUOM) {
        const toConversion = table_uom_conversion.find(
          (conv) => conv.alt_uom_id === toUOM,
        );
        if (toConversion && toConversion.base_qty) {
          return Math.round((baseQty / toConversion.base_qty) * 1000) / 1000;
        }
      }

      return baseQty;
    };

    const balanceFields = [
      "block_qty",
      "reserved_qty",
      "unrestricted_qty",
      "qualityinsp_qty",
      "intransit_qty",
      "balance_quantity",
      "sm_quantity",
    ];

    processedTemporaryData = temporaryData.map((record) => {
      const convertedRecord = { ...record };
      balanceFields.forEach((field) => {
        if (convertedRecord[field]) {
          convertedRecord[field] = convertQuantityFromTo(
            convertedRecord[field],
            tableUOMConversion,
            selectedUOM,
            quantityUOM,
            baseUOM,
          );
        }
      });
      return convertedRecord;
    });

    processedHuData = huData.map((record) => {
      if (record.row_type !== "item") return { ...record };
      const convertedRecord = { ...record };
      ["item_quantity", "sm_quantity"].forEach((field) => {
        if (convertedRecord[field]) {
          convertedRecord[field] = convertQuantityFromTo(
            convertedRecord[field],
            tableUOMConversion,
            selectedUOM,
            quantityUOM,
            baseUOM,
          );
        }
      });
      return convertedRecord;
    });
  }

  // HU items the user actually wants to transfer
  const filteredHuData = processedHuData.filter(
    (item) => item.row_type === "item" && parseFloat(item.sm_quantity || 0) > 0,
  );

  // Map handling_unit_id → header for quick category lookup during HU validation and persistence
  const huHeaderById = new Map();
  for (const row of processedHuData) {
    if (row.row_type === "header") {
      huHeaderById.set(row.handling_unit_id, row);
    }
  }

  // Validate HU rows:
  //   1) sm_quantity <= item_quantity
  //   2) header's category_from must differ from category_to (no-op transition rejected)
  for (const huItem of filteredHuData) {
    const smQty = parseFloat(huItem.sm_quantity || 0);
    const availableQty = parseFloat(huItem.item_quantity || 0);
    if (smQty > availableQty) {
      const header = huHeaderById.get(huItem.handling_unit_id);
      const huName = header?.handling_no || huItem.handling_unit_id;
      this.setData({
        error_message: `HU ${huName}: sm quantity (${smQty}) exceeds available (${availableQty}).`,
      });
      isValid = false;
      break;
    }

    const header = huHeaderById.get(huItem.handling_unit_id);
    if (header && header.category_from && header.category_to &&
        header.category_from === header.category_to) {
      const huName = header.handling_no || huItem.handling_unit_id;
      this.setData({
        error_message: `HU ${huName}: source and target category cannot be the same.`,
      });
      isValid = false;
      break;
    }
  }
  if (!isValid) return;

  const totalSmQuantity = processedTemporaryData
    .filter((item) => (item.sm_quantity || 0) > 0)
    .reduce((sum, item) => {
      const category_from = item.category_from;
      const category_to = item.category_to;
      const quantity = item.sm_quantity || 0;

      if (quantity > 0) {
        if (category_from && category_to && category_from === category_to) {
          this.setData({
            error_message: "Source and target category cannot be the same.",
          });
          isValid = false;
          return sum;
        }

        let selectedField;
        switch (category_from) {
          case "Unrestricted":
            selectedField = item.unrestricted_qty;
            break;
          case "Reserved":
            selectedField = item.reserved_qty;
            break;
          case "Quality Inspection":
            selectedField = item.qualityinsp_qty;
            break;
          case "Blocked":
            selectedField = item.block_qty;
            break;
          case "In Transit":
            selectedField = item.intransit_qty;
            break;
          default:
            this.setData({ error_message: "Invalid source category" });
            isValid = false;
            return sum;
        }

        if (selectedField < quantity) {
          this.setData({
            error_message: `Quantity in ${category_from} is not enough.`,
          });
          isValid = false;
          return sum;
        }
      }

      return sum + quantity;
    }, 0);

  if (!isValid) return;

  const totalHuQuantity = filteredHuData.reduce(
    (sum, item) => sum + parseFloat(item.sm_quantity || 0),
    0,
  );
  const totalCombined = totalSmQuantity + totalHuQuantity;

  this.setData({
    [`stock_movement.${rowIndex}.total_quantity`]: totalCombined,
  });

  const rowsToUpdate = processedTemporaryData.filter(
    (item) => (item.sm_quantity || 0) > 0,
  );

  // HU items in balance-shape. CAT: category_from / category_to come from the
  // matching HU header (NO_SPLIT — one transition per HU).
  const huAsBalanceRowsBase = filteredHuData.map((huItem) => {
    const header = huHeaderById.get(huItem.handling_unit_id);
    return {
      material_id: huItem.material_id,
      location_id: huItem.location_id,
      storage_location_id: huItem.storage_location_id || null,
      batch_id: huItem.batch_id || null,
      balance_id: huItem.balance_id || "",
      sm_quantity: parseFloat(huItem.sm_quantity) || 0,
      category_from: header?.category_from || "Unrestricted",
      category_to: header?.category_to || "Blocked",
      handling_unit_id: huItem.handling_unit_id,
      plant_id: allData.issuing_operation_faci,
      organization_id: allData.organization_id,
      is_deleted: 0,
      expired_date: huItem.expired_date || null,
      manufacturing_date: huItem.manufacturing_date || null,
    };
  });

  // Cross-line serial dup check: scan other rows' persisted temp_qty_data,
  // plus this row's new loose + HU entries.
  const otherRowEntries = [];
  (allData.stock_movement || []).forEach((line, idx) => {
    if (String(idx) === String(rowIndex)) return;
    if (!line.temp_qty_data) return;
    try {
      const parsed = JSON.parse(line.temp_qty_data);
      if (Array.isArray(parsed)) otherRowEntries.push(...parsed);
    } catch (e) {}
  });

  const serialLocationBatchMap = new Map();

  [...otherRowEntries, ...rowsToUpdate, ...huAsBalanceRowsBase].forEach((entry) => {
    if (entry.serial_number && entry.serial_number.trim() !== "") {
      const serialNumber = entry.serial_number.trim();
      const locationId = entry.location_id || "no-location";
      const batchId = entry.batch_id || "no-batch";

      const combinationKey = `${serialNumber}|${locationId}|${batchId}`;

      if (!serialLocationBatchMap.has(combinationKey)) {
        serialLocationBatchMap.set(combinationKey, []);
      }

      serialLocationBatchMap.get(combinationKey).push({
        serialNumber: serialNumber,
        locationId: locationId,
        batchId: batchId,
      });
    }
  });

  const duplicates = [];
  for (const [combinationKey, entries] of serialLocationBatchMap.entries()) {
    if (entries.length > 1) {
      duplicates.push({
        combinationKey: combinationKey,
        serialNumber: entries[0].serialNumber,
      });
    }
  }

  if (duplicates.length > 0) {
    const duplicateMessages = duplicates
      .map((dup) => `• Serial Number "${dup.serialNumber}".`)
      .join("\n");

    this.$message.error(
      `Duplicate serial numbers detected in the same location/batch combination:\n\n${duplicateMessages}\n\nThe same serial number cannot be allocated multiple times to the same location and batch. Please remove the duplicates and try again.`,
    );
    return;
  }

  const categoryMap = {
    Blocked: "BLK",
    Reserved: "RES",
    Unrestricted: "UNR",
    "Quality Inspection": "QIP",
    "In Transit": "INT",
  };
  const abbr = (cat) => categoryMap[cat] || cat || "UNR";

  const formatLooseDetails = async (filteredData) => {
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
        const qty = item.sm_quantity || 0;
        const transition = `${abbr(item.category_from)} → ${abbr(item.category_to)}`;

        let itemDetail = `${
          index + 1
        }. ${locationName}: ${qty} ${gdUOM} (${transition})`;

        if (itemData?.serial_number_management === 1 && item.serial_number) {
          itemDetail += `\nSerial: ${item.serial_number}`;
        }

        if (item.batch_id) {
          const batchName = batchMap[item.batch_id] || item.batch_id;
          itemDetail += `\n${
            itemData?.serial_number_management === 1 ? "Batch: " : "["
          }${batchName}${itemData?.serial_number_management === 1 ? "" : "]"}`;
        }

        if (item.remarks && item.remarks.trim() !== "") {
          itemDetail += `\nRemarks: ${item.remarks}`;
        }

        return itemDetail;
      })
      .join("\n");
  };

  const formatHuDetails = async (filteredHuList) => {
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
        const header = huHeaderById.get(item.handling_unit_id);
        const huName = header?.handling_no || item.handling_unit_id;
        const transition = `${abbr(header?.category_from)} → ${abbr(header?.category_to)}`;
        let detail = `${index + 1}. ${huName}: ${item.sm_quantity} ${gdUOM} (${transition})`;
        if (item.batch_id) {
          const batchName = batchMap[item.batch_id] || item.batch_id;
          detail += `\n   [Batch: ${batchName}]`;
        }
        return detail;
      })
      .join("\n");
  };

  const filteredLoose = processedTemporaryData.filter(
    (item) => (item.sm_quantity || 0) > 0,
  );
  const looseDetails = await formatLooseDetails(filteredLoose);
  const hasHu = filteredHuData.length > 0;
  const hasLoose = filteredLoose.length > 0;

  let formattedString;
  if (hasHu && hasLoose) {
    formattedString = `Total: ${totalCombined} ${gdUOM}\n\nLOOSE STOCK:\n${looseDetails}\n\nHANDLING UNIT:\n${await formatHuDetails(
      filteredHuData,
    )}`;
  } else if (hasHu) {
    formattedString = `Total: ${totalHuQuantity} ${gdUOM}\n\nHANDLING UNIT:\n${await formatHuDetails(
      filteredHuData,
    )}`;
  } else {
    formattedString = `Total: ${totalSmQuantity} ${gdUOM}\n\nDETAILS:\n${looseDetails}`;
  }

  // temp_qty_data carries loose + HU rows in balance shape (with category_from
  // / category_to). HU rows are distinguishable via handling_unit_id.
  // temp_hu_data carries the raw HU item rows + the headers of selected HUs,
  // so the dialog can re-hydrate sm_quantity AND the user's category_to choice
  // on next open.
  const cleanedLooseTempData = processedTemporaryData
    .filter((tempData) => tempData.sm_quantity > 0)
    .map((item) => {
      const cleaned = { ...item };
      if (cleaned.dialog_manufacturing_date !== undefined) {
        cleaned.manufacturing_date = cleaned.dialog_manufacturing_date;
        delete cleaned.dialog_manufacturing_date;
      }
      if (cleaned.dialog_expired_date !== undefined) {
        cleaned.expired_date = cleaned.dialog_expired_date;
        delete cleaned.dialog_expired_date;
      }
      return cleaned;
    });

  const combinedTempQty = [...cleanedLooseTempData, ...huAsBalanceRowsBase];

  // Persist HU item rows + headers of HUs that have any picked item. Headers
  // carry the user's category_to choice for re-hydration.
  const selectedHuIds = new Set(filteredHuData.map((it) => it.handling_unit_id));
  const selectedHeaders = processedHuData.filter(
    (row) => row.row_type === "header" && selectedHuIds.has(row.handling_unit_id),
  );
  const tempHuPayload = [...filteredHuData, ...selectedHeaders];

  this.setData({
    [`stock_movement.${rowIndex}.temp_qty_data`]:
      JSON.stringify(combinedTempQty),
    [`stock_movement.${rowIndex}.temp_hu_data`]: JSON.stringify(tempHuPayload),
    [`stock_movement.${rowIndex}.stock_summary`]: formattedString,
  });

  this.models["previous_material_uom"] = undefined;
  this.setData({ error_message: "" });
  this.closeDialog("sm_item_balance");
})();
