const fetchItemData = async (itemID) => {
  const resItem = await db
    .collection("Item")
    .field("material_costing_method,item_category")
    .where({ id: itemID })
    .get();

  if (!resItem || resItem.data.length === 0) return;
  else return resItem.data[0];
};

const fetchBatchID = async (batchNo, grNumber, itemID) => {
  try {
    const organizationID = this.getValue("organization_id");
    const plantID = this.getValue("plant");

    const resBatch = await db
      .collection("batch")
      .where({
        material_id: itemID,
        batch_number: batchNo,
        transaction_no: grNumber,
        plant_id: plantID,
        organization_id: organizationID,
      })
      .get();

    if (!resBatch || resBatch.data.length === 0) return;
    else return resBatch.data[0].id;
  } catch (error) {
    console.error(error);
  }
};

const processData = async (existingPRT, tablePRT) => {
  for (const [rowIndex, prt] of tablePRT.entries()) {
    const index = existingPRT.length + rowIndex;

    if (!prt.material_id && prt.material_desc !== "") {
      this.disabled(`table_prt.${index}.select_return_qty`, true);
      this.disabled(`table_prt.${index}.return_quantity`, false);
    } else {
      this.disabled(`table_prt.${index}.select_return_qty`, false);
      this.disabled(`table_prt.${index}.return_quantity`, true);
    }

    if (prt.batch_no !== "-") {
      const batchID = await fetchBatchID(
        prt.batch_no,
        prt.gr_number,
        prt.material_id
      );

      this.setData({ [`table_prt.${index}.batch_id`]: batchID });
    }
  }
};

const convertToBaseUOM = (quantity, altUOM, itemData) => {
  if (!altUOM || altUOM === itemData.based_uom) {
    return quantity;
  }

  const uomConversion = itemData.table_uom_conversion?.find(
    (conv) => conv.alt_uom_id === altUOM
  );

  if (uomConversion && uomConversion.base_qty) {
    return quantity * uomConversion.base_qty;
  }

  return quantity;
};

(async () => {
  const referenceType = this.getValue(`dialog_select_item.reference_type`);
  const currentItemArray = this.getValue(`dialog_select_item.item_array`);
  let existingPRT = this.getValue("table_prt");
  const previousReferenceType = this.getValue("reference_type");
  const supplierName = this.getValue("supplier_id");

  let tablePRT = [];
  let purchaseOrderNumber = [];
  let poId = [];
  let goodsReceivingNumber = [];
  let grId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one goods receiving / item.", "Error", {
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

    existingPRT = [];
  }

  const uniqueSuppliers = new Set(currentItemArray.map((gr) => gr.supplier_id));
  const allSameSupplier = uniqueSuppliers.size === 1;

  if (!allSameSupplier) {
    this.$alert(
      "Returned item(s) from more than two different suppliers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );
    return;
  }

  if (supplierName && supplierName !== [...uniqueSuppliers][0]) {
    await this.$confirm(
      `You've selected a different supplier than previously used. <br><br>Switching will <strong>reset all items</strong> in this document. Do you want to proceed?`,
      "Different Supplier Detected",
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

    existingPRT = [];
  }

  this.closeDialog("dialog_select_item");
  this.showLoading();

  switch (referenceType) {
    case "Document":
      for (const gr of currentItemArray) {
        for (const grItem of gr.table_gr) {
          let itemData;
          if (grItem.item_id) {
            itemData = await fetchItemData(grItem.item_id);
          }

          let receivedQuantity = grItem.received_qty;
          let UOM = grItem.item_uom;

          if (itemData && itemData.serial_number_management === 1) {
            receivedQuantity = convertToBaseUOM(
              grItem.received_qty,
              grItem.item_uom,
              itemData
            );

            UOM = itemData.based_uom;
          }

          const newtablePRTRecord = {
            material_id: grItem.item_id || null,
            material_name: grItem.item_name,
            material_desc: grItem.item_desc,
            more_desc: grItem.more_desc,
            received_qty: parseFloat(receivedQuantity.toFixed(3)),
            return_quantity: 0,
            return_uom_id: UOM,
            po_number: grItem.line_po_no,
            gr_number: gr.gr_no,
            gr_date: gr.gr_date,
            line_remark_1: grItem.line_remark_1,
            line_remark_2: grItem.line_remark_2,
            batch_no: grItem.item_batch_no,
            returned_quantity: parseFloat(grItem.return_quantity.toFixed(3)),
            unit_price: grItem.unit_price,
            total_price: grItem.total_price,
            costing_method: itemData?.material_costing_method || null,
            item_category_id: itemData?.item_category || null,
            po_id: grItem.line_po_id,
            po_line_id: grItem.po_line_item_id,
            gr_id: gr.goods_receiving_id,
            gr_line_id: grItem.id,
            is_serialized_item: grItem.is_serialized_item,
          };

          tablePRT.push(newtablePRTRecord);
        }
      }

      break;

    case "Item":
      for (const grItem of currentItemArray) {
        let receivedQuantity = grItem.received_qty;
        let UOM = grItem.item_uom;

        if (grItem.is_serialized_item === 1) {
          receivedQuantity = grItem.base_received_qty;
          UOM = grItem.item.base_item_uom;
        }

        const newtablePRTRecord = {
          material_id: grItem.item.id || null,
          material_name: grItem.item.material_name,
          material_desc: grItem.item_desc,
          more_desc: grItem.more_desc,
          received_qty: parseFloat(receivedQuantity.toFixed(3)),
          return_quantity: 0,
          return_uom_id: UOM,
          po_number: grItem.purchase_order_id.purchase_order_no,
          gr_number: grItem.goods_receiving_id.gr_no,
          gr_date: grItem.goods_receiving_id.gr_date,
          line_remark_1: grItem.line_remark_1,
          line_remark_2: grItem.line_remark_2,
          batch_no: grItem.item_batch_no,
          returned_quantity: parseFloat(grItem.return_quantity.toFixed(3)),
          unit_price: grItem.unit_price,
          total_price: grItem.total_price,
          costing_method: grItem.item?.material_costing_method || null,
          item_category_id: grItem.item?.item_category || null,
          po_id: grItem.purchase_order_id.id,
          po_line_id: grItem.purchase_order_line_id.id,
          gr_id: grItem.goods_receiving_id.id,
          gr_line_id: grItem.goods_receiving_line_id,
          is_serialized_item: grItem.is_serialized_item,
        };

        tablePRT.push(newtablePRTRecord);
      }
      break;
  }

  tablePRT = tablePRT.filter(
    (prt) =>
      prt.returned_quantity !== prt.received_qty &&
      !existingPRT.find((prtItem) => prtItem.gr_line_id === prt.gr_line_id)
  );

  const latesttablePRT = [...existingPRT, ...tablePRT];
  console.log("latesttablePRT", latesttablePRT);

  poId = [...new Set(latesttablePRT.map((prt) => prt.po_id))];
  purchaseOrderNumber = [
    ...new Set(latesttablePRT.map((prt) => prt.po_number)),
  ];
  grId = [...new Set(latesttablePRT.map((prt) => prt.gr_id))];
  goodsReceivingNumber = [
    ...new Set(latesttablePRT.map((prt) => prt.gr_number)),
  ];

  await this.setData({
    supplier_id: currentItemArray[0].supplier_id,
    table_prt: [...existingPRT, ...tablePRT],
    po_no_display: purchaseOrderNumber.join(", "),
    po_id: poId,
    gr_no_display: goodsReceivingNumber.join(", "),
    gr_id: grId,
    reference_type: referenceType,
  });

  setTimeout(async () => {
    await processData(existingPRT, tablePRT);
  }, 50);

  this.hideLoading();
})();
