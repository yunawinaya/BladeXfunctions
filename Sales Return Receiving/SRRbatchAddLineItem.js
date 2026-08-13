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

const checkSerialNumber = async (tempData, index) => {
  const serialNumbers = tempData
    .filter(
      (item) =>
        item.serial_number &&
        item.serial_number !== "" &&
        item.serial_number !== null
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
      serialNumbers
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
  const referenceType = this.getValue(`dialog_select_item.reference_type`);
  const currentItemArray = this.getValue(`dialog_select_item.item_array`);
  let existingSRR = this.getValue("table_srr");
  const previousReferenceType = this.getValue("reference_type");
  const defaultBinLocation = this.getValue("default_bin_location");
  const plantId = this.getValue("plant_id");

  let tableSRR = [];
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
      }
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingSRR = [];
  }

  const uniqueCustomers = new Set(
    currentItemArray.map((srr) => srr.customer_id)
  );
  const allSameCustomer = uniqueCustomers.size === 1;

  if (!allSameCustomer) {
    this.$alert(
      "Received returned item(s) from more than two different customers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      }
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
          };

          tableSRR.push(newtableSRRRecord);
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
        };

        tableSRR.push(newtableSRRRecord);
      }
      break;
  }

  tableSRR = tableSRR.filter(
    (srr) =>
      srr.to_receive_qty !== 0 &&
      !existingSRR.find((srrItem) => srrItem.sr_line_id === srr.sr_line_id)
  );

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
          true
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
