const fetchItemData = async (itemID) => {
  const resItem = await db
    .collection("Item")
    .field("item_batch_management,batch_number_genaration,table_default_bin")
    .where({ id: itemID })
    .get();

  if (!resItem || resItem.data.length === 0) return;
  else return resItem.data[0];
};

// Item master default bin for this plant. Takes priority over the plant-level
// default; a row without a bin is treated as unconfigured so we never stamp a
// blank bin on the line.
const getItemDefaultBin = (tableDefaultBin, plantId) => {
  if (!plantId || !Array.isArray(tableDefaultBin)) return null;

  const matchingBin = tableDefaultBin.find(
    (bin) => bin.plant_id === plantId && bin.bin_location,
  );

  if (!matchingBin) return null;

  return {
    binLocation: matchingBin.bin_location,
    storageLocation: matchingBin.storage_location || null,
  };
};

// `temp_qty_data` is the balance breakdown the delivery was picked from, so it
// records which batch every delivered unit came out of.
const parseTempQtyData = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const sourceBatchesOf = (tempQtyData) => {
  const byBatch = new Map();

  for (const entry of parseTempQtyData(tempQtyData)) {
    if (!entry.batch_id) continue;

    const qty = parseFloat(
      entry.gd_quantity ??
        entry.unrestricted_qty ??
        entry.balance_quantity ??
        0,
    );
    if (!(qty > 0)) continue;

    const existing = byBatch.get(entry.batch_id);
    if (existing) existing.qty += qty;
    else byBatch.set(entry.batch_id, { batch_id: entry.batch_id, qty });
  }

  return [...byBatch.values()];
};

const fetchBatchNumbers = async (batchIds) => {
  if (batchIds.length === 0) return new Map();

  const resBatch = await db
    .collection("batch")
    .filter(new Filter().in("id", batchIds).build())
    .get();

  return new Map(
    (resBatch?.data || []).map((batch) => [batch.id, batch.batch_number]),
  );
};

// Qty already put back per (SR line, batch), so a second receipt does not
// return stock into a batch that earlier receipts already filled.
const fetchReceivedByBatch = async (srLineIds) => {
  const received = new Map();
  if (srLineIds.length === 0) return received;

  const resSRRLine = await db
    .collection("sales_return_receiving_05z4r94a_sub")
    .filter(new Filter().in("sr_line_id", srLineIds).build())
    .get();

  for (const line of resSRRLine?.data || []) {
    if (!line.batch_id) continue;

    const key = `${line.sr_line_id}|${line.batch_id}`;
    received.set(
      key,
      (received.get(key) || 0) + parseFloat(line.received_qty || 0),
    );
  }

  return received;
};

// sales_return_setup.generate_new_batch = 0 means the plant returns stock into
// the batch it was delivered from, so the row must carry that batch_id instead
// of a placeholder the save workflow would turn into a brand new batch. A line
// delivered out of several batches becomes one row per batch.
const applySourceBatches = async (rows, sourceMeta) => {
  const batchesPerRow = rows.map((row, index) =>
    row.batch_no === "-" ? [] : sourceBatchesOf(sourceMeta[index]),
  );

  const unresolved = [
    ...new Set(
      rows
        .filter(
          (row, index) =>
            row.batch_no !== "-" && batchesPerRow[index].length === 0,
        )
        .map((row) => row.material_name),
    ),
  ];

  if (unresolved.length > 0) {
    return {
      rows: null,
      error: `This plant returns stock into the batch it was delivered from, but no delivered batch could be found for:<br><br>${unresolved.join(
        "<br>",
      )}<br><br>Please check the goods delivery of these item(s) before receiving them.`,
    };
  }

  const multiBatchSRLineIds = [
    ...new Set(
      rows
        .filter((_row, index) => batchesPerRow[index].length > 1)
        .map((row) => row.sr_line_id)
        .filter(Boolean),
    ),
  ];

  const [batchNumberById, receivedByBatch] = await Promise.all([
    fetchBatchNumbers([
      ...new Set(batchesPerRow.flat().map((batch) => batch.batch_id)),
    ]),
    fetchReceivedByBatch(multiBatchSRLineIds),
  ]);

  const expanded = [];

  rows.forEach((row, index) => {
    const batches = batchesPerRow[index];

    if (batches.length === 0) {
      expanded.push(row);
      return;
    }

    if (batches.length === 1) {
      expanded.push({
        ...row,
        batch_id: batches[0].batch_id,
        batch_no: batchNumberById.get(batches[0].batch_id) || row.batch_no,
      });
      return;
    }

    let outstanding = parseFloat(row.to_receive_qty || 0);
    const rowsForLine = [];

    for (const batch of batches) {
      if (!(outstanding > 0)) break;

      const available =
        batch.qty -
        (receivedByBatch.get(`${row.sr_line_id}|${batch.batch_id}`) || 0);
      if (!(available > 0)) continue;

      const share = Math.min(available, outstanding);
      outstanding -= share;

      rowsForLine.push({
        ...row,
        batch_id: batch.batch_id,
        batch_no: batchNumberById.get(batch.batch_id) || row.batch_no,
        to_receive_qty: share,
      });
    }

    // Anything the source batches cannot account for still has to be
    // receivable, so it stays on the first batch rather than disappearing.
    if (outstanding > 0) {
      if (rowsForLine.length === 0) {
        rowsForLine.push({
          ...row,
          batch_id: batches[0].batch_id,
          batch_no: batchNumberById.get(batches[0].batch_id) || row.batch_no,
        });
      } else {
        rowsForLine[0].to_receive_qty += outstanding;
      }
    }

    expanded.push(...rowsForLine);
  });

  return { rows: expanded, error: null };
};

// The SR line records which handling unit each delivered unit sat in. A line
// delivered out of several units becomes one receiving row per unit -- the same
// shape applySourceBatches uses for source batches.
const sourceHUsOf = (tempHuData) => {
  const byHU = new Map();

  for (const entry of parseTempQtyData(tempHuData)) {
    if (!entry.handling_unit_id) continue;

    const qty = parseFloat(entry.deliver_quantity ?? entry.item_quantity ?? 0);
    const existing = byHU.get(entry.handling_unit_id);

    if (existing) existing.qty += qty;
    else
      byHU.set(entry.handling_unit_id, {
        handling_unit_id: entry.handling_unit_id,
        handling_no: entry.handling_no || "",
        qty: qty,
      });
  }

  return [...byHU.values()];
};

// Qty already put back per (SR line, handling unit), so a second receipt does
// not refill a unit an earlier receipt already filled.
const fetchReceivedByHU = async (srLineIds) => {
  const received = new Map();
  if (srLineIds.length === 0) return received;

  const resSRRLine = await db
    .collection("sales_return_receiving_05z4r94a_sub")
    .filter(new Filter().in("sr_line_id", srLineIds).build())
    .get();

  for (const line of resSRRLine?.data || []) {
    // hu_id records the unit the goods were DELIVERED in and is never cleared,
    // so a row the receiver took loose or into a new unit still carries it.
    // Only rows that actually went back into that unit consume its capacity.
    if (!line.hu_id || line.hu_option !== "Original") continue;

    const key = `${line.sr_line_id}|${line.hu_id}`;
    received.set(
      key,
      (received.get(key) || 0) + parseFloat(line.received_qty || 0),
    );
  }

  return received;
};

// Splits a row per source handling unit and narrows that row's temp_qty_data to
// the entries belonging to it, so the batch split that runs afterwards resolves
// the batch of the portion this row actually represents rather than of the whole
// delivered line.
const applySourceHUs = async (rows, sourceMeta, huMeta) => {
  const husPerRow = rows.map((_row, index) => sourceHUsOf(huMeta[index]));

  const multiHuSRLineIds = [
    ...new Set(
      rows
        .filter((_row, index) => husPerRow[index].length > 1)
        .map((row) => row.sr_line_id)
        .filter(Boolean),
    ),
  ];

  const receivedByHU = await fetchReceivedByHU(multiHuSRLineIds);

  const metaForHU = (meta, huId) => {
    const entries = parseTempQtyData(meta).filter(
      (entry) => String(entry.handling_unit_id || "") === String(huId),
    );
    return entries.length > 0 ? JSON.stringify(entries) : meta;
  };

  const pick = (row, hu, overrides) => ({
    ...row,
    hu_option: "Original",
    hu_id: hu.handling_unit_id,
    hu_no_display: hu.handling_no,
    ...overrides,
  });

  const expandedRows = [];
  const expandedMeta = [];

  rows.forEach((row, index) => {
    const hus = husPerRow[index];

    if (hus.length === 0) {
      expandedRows.push(row);
      expandedMeta.push(sourceMeta[index]);
      return;
    }

    if (hus.length === 1) {
      expandedRows.push(pick(row, hus[0], {}));
      expandedMeta.push(metaForHU(sourceMeta[index], hus[0].handling_unit_id));
      return;
    }

    let outstanding = parseFloat(row.to_receive_qty || 0);
    const rowsForLine = [];
    const metaForLine = [];

    for (const hu of hus) {
      if (!(outstanding > 0)) break;

      const available =
        hu.qty -
        (receivedByHU.get(`${row.sr_line_id}|${hu.handling_unit_id}`) || 0);
      if (!(available > 0)) continue;

      const share = Math.min(available, outstanding);
      outstanding -= share;

      rowsForLine.push(pick(row, hu, { to_receive_qty: share }));
      metaForLine.push(metaForHU(sourceMeta[index], hu.handling_unit_id));
    }

    // Anything the source units cannot account for still has to be receivable,
    // so it stays on the first unit rather than disappearing.
    if (outstanding > 0) {
      if (rowsForLine.length === 0) {
        rowsForLine.push(pick(row, hus[0], {}));
        metaForLine.push(metaForHU(sourceMeta[index], hus[0].handling_unit_id));
      } else {
        rowsForLine[0].to_receive_qty += outstanding;
      }
    }

    expandedRows.push(...rowsForLine);
    expandedMeta.push(...metaForLine);
  });

  return { rows: expandedRows, sourceMeta: expandedMeta };
};

const checkSerialNumber = async (tempData, index) => {
  const serialNumbers = tempData
    .filter(
      (item) =>
        item.serial_number &&
        item.serial_number !== "" &&
        item.serial_number !== null,
    )
    .map((item) => item.serial_number.trim());

  console.log("serialNumbers", serialNumbers);
  if (serialNumbers.length > 0) {
    await this.setData({
      [`table_srr.${index}.serial_numbers`]: serialNumbers,
    });
    await this.display(`table_srr.select_serial_number`);
    await this.disabled(`table_srr.${index}.select_serial_number`, false);
    await this.disabled(`table_srr.${index}.received_qty`, true);
    await this.setOptionData(
      [`table_srr.${index}.select_serial_number`],
      serialNumbers,
    );
  } else {
    await this.setData({
      [`table_srr.${index}.serial_numbers`]: null,
    });
    await this.disabled(`table_srr.${index}.select_serial_number`, true);
    await this.disabled(`table_srr.${index}.received_qty`, false);
  }
};

(async () => {
  const referenceType = arguments[0].referenceType;
  const currentItemArray = arguments[0].itemArray;
  let existingSRR = this.getValue("table_srr");
  const previousReferenceType = this.getValue("reference_type");
  const defaultBinLocation = this.getValue("default_bin_location");
  const plantId = this.getValue("plant_id");
  const newBatch = this.getValue("new_batch");

  let tableSRR = [];
  let sourceMeta = [];
  let huMeta = [];
  let salesReturnNumber = [];
  let srId = [];
  let salesOrderNumber = [];
  let soId = [];
  let goodsDeliveryNumber = [];
  let gdId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one sales return / item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  if (previousReferenceType && previousReferenceType !== referenceType) {
    await this.$confirm(
      `You've selected a different reference type than previously used. <br><br>Current Reference Type: ${referenceType} <br>Previous Reference Type: ${previousReferenceType} <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Reference Type Detected",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingSRR = [];
  }

  const uniqueCustomers = new Set(
    currentItemArray.map((srr) => srr.customer_id),
  );
  const allSameCustomer = uniqueCustomers.size === 1;

  if (!allSameCustomer) {
    this.$alert(
      "Received returned item(s) from more than two different customers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    return;
  }

  this.closeDialog("dialog_select_item");
  this.showLoading();

  // "Item" reference builds its lines straight from the dialog rows without an
  // item fetch. Reuse the subform the row already carries and resolve only the
  // ones missing it, in ONE batched fetch.
  const defaultBinByItem = new Map();

  if (referenceType === "Item") {
    const missingItemIds = [];

    for (const srItem of currentItemArray) {
      const itemId = srItem.item?.id;
      if (!itemId || defaultBinByItem.has(itemId)) continue;

      if (Array.isArray(srItem.item.table_default_bin)) {
        defaultBinByItem.set(itemId, srItem.item.table_default_bin);
      } else if (!missingItemIds.includes(itemId)) {
        missingItemIds.push(itemId);
      }
    }

    if (missingItemIds.length > 0) {
      const resItems = await db
        .collection("Item")
        .filter(new Filter().in("id", missingItemIds).build())
        .get();

      for (const item of resItems?.data || []) {
        defaultBinByItem.set(item.id, item.table_default_bin);
      }
    }
  }

  switch (referenceType) {
    case "Document":
      for (const sr of currentItemArray) {
        for (const srItem of sr.table_sr) {
          let batchNo = "-";
          let itemDefaultBin = null;
          // Fetch item data to check batch management
          if (srItem.material_id) {
            const itemData = await fetchItemData(srItem.material_id);

            itemDefaultBin = getItemDefaultBin(
              itemData?.table_default_bin,
              plantId,
            );

            if (itemData && itemData.item_batch_management === 1) {
              if (
                itemData.batch_number_genaration ===
                "According To System Settings"
              ) {
                batchNo = "Auto-generated batch number";
              } else {
                batchNo = "";
              }
            }
          }
          const newtableSRRRecord = {
            material_id: srItem.material_id,
            material_name: srItem.material_name,
            receiving_detail: srItem.material_desc,
            more_desc: srItem.more_desc || "",
            sr_number: sr.sales_return_no,
            gd_number: srItem.gd_number,
            so_number: srItem.line_so_no,
            so_quantity: srItem.so_quantity,
            gd_quantity: srItem.good_delivery_qty,
            expected_return_qty: srItem.expected_return_qty,
            to_receive_qty: srItem.expected_return_qty - srItem.received_qty,
            quantity_uom: srItem.quantity_uom,
            return_reason: srItem.return_reason,

            sr_id: sr.sales_return_id,
            gd_id: srItem.gd_id,
            so_id: srItem.so_id,
            sr_line_id: srItem.id,
            gd_line_id: srItem.gd_line_id,
            so_line_id: srItem.so_line_id,
            item_category_id: srItem.item_category_id,

            unit_price: srItem.unit_price,
            total_price: srItem.total_price,

            line_remark_1: srItem.line_remark_1 || "",
            line_remark_2: srItem.line_remark_2 || "",

            fifo_sequence: srItem.fifo_sequence,
            costing_method: srItem.costing_method,
            location_id: itemDefaultBin?.binLocation || defaultBinLocation,
            // Only stamped when the item master supplies one. This line never
            // managed storage_location_id before, and a bin taken from the item
            // master belongs to the storage location recorded beside it.
            ...(itemDefaultBin?.storageLocation
              ? { storage_location_id: itemDefaultBin.storageLocation }
              : {}),
            batch_no: batchNo,
            inventory_category: "Unrestricted",
            serial_numbers: srItem.temp_qty_data,
            // Settled by applySourceHUs below when the line carries one.
            hu_option: "None",
            hu_source: srItem.hu_source || "",
          };

          tableSRR.push(newtableSRRRecord);
          sourceMeta.push(srItem.temp_qty_data);
          huMeta.push(srItem.temp_hu_data);
        }
      }

      break;

    case "Item":
      for (const srItem of currentItemArray) {
        const itemDefaultBin = getItemDefaultBin(
          defaultBinByItem.get(srItem.item?.id),
          plantId,
        );

        const newtableSRRRecord = {
          material_id: srItem.item.id,
          material_name: srItem.item.material_name,
          receiving_detail: srItem.material_desc,
          more_desc: srItem.more_desc || "",
          sr_number: srItem.sales_return_id.sales_return_no,
          gd_number: srItem.goods_delivery_id.delivery_no,
          so_number: srItem.sales_order_id.so_no,
          so_quantity: srItem.so_quantity,
          gd_quantity: srItem.good_delivery_qty,
          expected_return_qty: srItem.expected_return_qty,
          to_receive_qty: srItem.expected_return_qty - srItem.received_qty,
          quantity_uom: srItem.quantity_uom,
          return_reason: srItem.return_reason,

          sr_id: srItem.sales_return_id.id,
          gd_id: srItem.goods_delivery_id.id,
          so_id: srItem.sales_order_id.id,
          sr_line_id: srItem.sales_return_line_id,
          gd_line_id: srItem.goods_delivery_line_id.id,
          so_line_id: srItem.sales_order_line_id.id,
          item_category_id: srItem.item.item_category,

          unit_price: srItem.unit_price,
          total_price: srItem.total_price,

          line_remark_1: srItem.line_remark_1 || "",
          line_remark_2: srItem.line_remark_2 || "",

          fifo_sequence: srItem.fifo_sequence,
          costing_method: srItem.costing_method,
          location_id: itemDefaultBin?.binLocation || defaultBinLocation,
          // Only stamped when the item master supplies one. This line never
          // managed storage_location_id before, and a bin taken from the item
          // master belongs to the storage location recorded beside it.
          ...(itemDefaultBin?.storageLocation
            ? { storage_location_id: itemDefaultBin.storageLocation }
            : {}),
          batch_no:
            srItem.item.item_batch_management === 1
              ? srItem.item.batch_number_genaration ===
                "According To System Settings"
                ? "Auto-generated batch number"
                : ""
              : "-",
          inventory_category: "Unrestricted",
          serial_numbers: srItem.temp_qty_data,
          // Settled by applySourceHUs below when the line carries one.
          hu_option: "None",
          hu_source: srItem.hu_source || "",
        };

        tableSRR.push(newtableSRRRecord);
        sourceMeta.push(srItem.temp_qty_data);
        huMeta.push(srItem.temp_hu_data);
      }
      break;
  }

  // Filtered with the source breakdown alongside it so the two stay aligned.
  const keptSourceMeta = [];
  const keptHuMeta = [];
  tableSRR = tableSRR.filter((srr, index) => {
    const keep =
      srr.to_receive_qty !== 0 &&
      !existingSRR.find((srrItem) => srrItem.sr_line_id === srr.sr_line_id);

    if (keep) {
      keptSourceMeta.push(sourceMeta[index]);
      keptHuMeta.push(huMeta[index]);
    }
    return keep;
  });

  // Handling units first: it re-aligns temp_qty_data per row, which is what the
  // batch split below reads.
  const resolvedHUs = await applySourceHUs(tableSRR, keptSourceMeta, keptHuMeta);
  tableSRR = resolvedHUs.rows;

  if (newBatch === 0) {
    const resolved = await applySourceBatches(tableSRR, resolvedHUs.sourceMeta);

    if (resolved.error) {
      this.hideLoading();
      this.$alert(resolved.error, "Missing Source Batch", {
        confirmButtonText: "OK",
        type: "error",
        dangerouslyUseHTMLString: true,
      });
      return;
    }

    tableSRR = resolved.rows;
  }

  const latesttableSRR = [...existingSRR, ...tableSRR];
  console.log("latesttableSRR", latesttableSRR);

  soId = [...new Set(latesttableSRR.map((srr) => srr.so_id))];
  salesOrderNumber = [...new Set(latesttableSRR.map((srr) => srr.so_number))];
  srId = [...new Set(latesttableSRR.map((srr) => srr.sr_id))];
  salesReturnNumber = [...new Set(latesttableSRR.map((srr) => srr.sr_number))];
  gdId = [...new Set(latesttableSRR.map((srr) => srr.gd_id))];
  goodsDeliveryNumber = [
    ...new Set(latesttableSRR.map((srr) => srr.gd_number)),
  ];

  await this.setData({
    customer_id: currentItemArray[0].customer_id,
    table_srr: latesttableSRR,
    so_no_display: salesOrderNumber.join(", "),
    so_id: soId,
    sr_no_display: salesReturnNumber.join(", "),
    sr_id: srId,
    gd_no_display: goodsDeliveryNumber.join(", "),
    gd_id: gdId,
    reference_type: referenceType,
  });

  setTimeout(async () => {
    for (const [index, item] of latesttableSRR.entries()) {
      if (item.batch_no !== "-") {
        this.display([
          "table_srr.manufacturing_date",
          "table_srr.expired_date",
        ]);
        if (item.batch_no === "") {
          this.disabled(`table_srr.${index}.batch_no`, false);
        }
      } else {
        this.disabled(
          [
            `table_srr.${index}.manufacturing_date`,
            `table_srr.${index}.expired_date`,
          ],
          true,
        );
      }
    }
  }, 50);
  setTimeout(async () => {
    for (const [index, item] of latesttableSRR.entries()) {
      if (item.serial_numbers) {
        await checkSerialNumber(JSON.parse(item.serial_numbers), index);
      }
    }
  }, 100);

  this.hideLoading();
})();
