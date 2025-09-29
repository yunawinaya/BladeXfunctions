const fetchItemData = async (itemID) => {
  const resItem = await db
    .collection("Item")
    .field(
      "receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method,item_category,serial_number_management,table_uom_conversion,based_uom,formula"
    )
    .where({ id: itemID })
    .get();

  if (!resItem || resItem.data.length === 0) return;
  else return resItem.data[0];
};

const processData = async (
  existingGR,
  tableGR,
  invCategoryData,
  putawaySetupData
) => {
  for (const [rowIndex, gr] of tableGR.entries()) {
    const index = existingGR.length + rowIndex;
    console.log(gr.item_id);
    // check item batch field
    this.disabled(
      `table_gr.${index}.item_batch_no`,
      (gr.item_batch_no !== "" && gr.item_id !== "") ||
        (!gr.item_id && gr.item_batch_no === "")
    );

    // set inventory category option and default value
    if (gr.inspection_required === "No") {
      if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
        const invCategoryOption = invCategoryData.filter(
          (cat) => cat.dict_key === "Unrestricted" || cat.dict_key === "Blocked"
        );
        this.setOptionData(`table_gr.${index}.inv_category`, invCategoryOption);

        this.setData({
          [`table_gr.${index}.inv_category`]: "Unrestricted",
        });
      } else if (putawaySetupData && putawaySetupData.putaway_required === 1) {
        const invCategoryOption = invCategoryData.filter(
          (cat) => cat.dict_key === "In Transit"
        );
        this.setOptionData(`table_gr.${index}.inv_category`, invCategoryOption);

        this.setData({
          [`table_gr.${index}.inv_category`]: "In Transit",
        });

        this.display("assigned_to");
      }
    } else if (gr.inspection_required === "Yes") {
      if (!putawaySetupData || putawaySetupData.putaway_required === 0) {
        const invCategoryOption = invCategoryData.filter(
          (cat) =>
            cat.dict_key === "Unrestricted" ||
            cat.dict_key === "Blocked" ||
            cat.dict_key === "Quality Inspection"
        );
        this.setOptionData(`table_gr.${index}.inv_category`, invCategoryOption);
      } else if (putawaySetupData && putawaySetupData.putaway_required === 1) {
        const invCategoryOption = invCategoryData.filter(
          (cat) =>
            cat.dict_key === "In Transit" ||
            cat.dict_key === "Quality Inspection"
        );
        this.setOptionData(`table_gr.${index}.inv_category`, invCategoryOption);
        this.display("assigned_to");
      }

      this.setData({
        [`table_gr.${index}.inv_category`]: "Quality Inspection",
      });
    }

    // disabled / enabled manufacturing & expired date
    if (gr.item_batch_no === "-") {
      this.disabled(
        [
          `table_gr.${index}.manufacturing_date`,
          `table_gr.${index}.expired_date`,
        ],
        true
      );
    }
  }
};

const convertAltToBase = (altQty, uomConversionTable, altUOM) => {
  if (
    !Array.isArray(uomConversionTable) ||
    uomConversionTable.length === 0 ||
    !altUOM
  ) {
    return altQty;
  }

  const uomConversion = uomConversionTable.find(
    (conv) => conv.alt_uom_id === altUOM && conv.alt_uom_id !== conv.base_uom_id
  );

  if (!uomConversion || !uomConversion.alt_qty) {
    return altQty;
  }

  return Math.round((altQty / uomConversion.alt_qty) * 1000) / 1000;
};

(async () => {
  const referenceType = this.getValue(`dialog_select_item.reference_type`);
  const currentItemArray = this.getValue(`dialog_select_item.item_array`);
  let existingGR = this.getValue("table_gr");
  const predefinedData = this.getValue("predefined_data");
  const previousReferenceType = this.getValue("reference_type");
  const supplierName = this.getValue("supplier_name");

  const putawaySetupData = predefinedData[0].putawaySetup;
  const defaultBinLocationID = predefinedData[0].defaultBinLocation;
  const invCategoryData = predefinedData[0].invCategory;

  let tableGR = [];
  let purchaseOrderNumber = [];
  let poId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one purchase order / item.", "Error", {
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

    existingGR = [];
  }

  const uniqueSuppliers = new Set(
    currentItemArray.map((po) =>
      referenceType === "Document"
        ? po.supplier_id
        : po.purchase_order.po_supplier_id
    )
  );
  const allSameSupplier = uniqueSuppliers.size === 1;

  if (!allSameSupplier) {
    this.$alert(
      "Received item(s) from more than two different suppliers is not allowed.",
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

    existingGR = [];
  }

  this.closeDialog("dialog_select_item");
  this.showLoading();

  switch (referenceType) {
    case "Document":
      for (const po of currentItemArray) {
        for (const poItem of po.table_po) {
          let itemData;
          if (poItem.item_id) {
            itemData = await fetchItemData(poItem.item_id);
          }

          const newTableGrRecord = {
            item_id: poItem.item_id || null,
            item_name: poItem.item_name,
            item_desc: poItem.item_desc,
            more_desc: poItem.more_desc,
            ordered_qty: poItem.quantity,
            ordered_qty_uom: poItem.quantity_uom || null,
            base_ordered_qty: poItem.quantity,
            base_ordered_qty_uom: poItem.quantity_uom || null,
            base_item_uom: poItem.quantity_uom || null,
            base_received_qty_uom: poItem.quantity_uom || null,
            inspection_required:
              itemData?.receiving_inspection === 1 ? "Yes" : "No",
            to_received_qty: 0,
            to_received_qty_uom: poItem.quantity_uom || null,
            received_qty: parseFloat(
              (poItem.quantity - (poItem.received_qty || 0)).toFixed(3)
            ),
            base_received_qty: parseFloat(
              (poItem.quantity - (poItem.received_qty || 0)).toFixed(3)
            ),
            item_uom: poItem.quantity_uom || null,
            location_id: defaultBinLocationID,
            item_batch_no: itemData
              ? itemData?.item_batch_management === 0
                ? "-"
                : itemData?.batch_number_genaration ===
                  "According To System Settings"
                ? "Auto-generated batch number"
                : ""
              : "-",
            inv_category: "",
            line_po_no: po.purchase_order_number,
            initial_received_qty: parseFloat(
              (poItem.received_qty || 0).toFixed(3)
            ),
            line_po_id: po.purchase_order_id,
            unit_price: poItem.unit_price,
            total_price: poItem.po_amount,
            item_costing_method: itemData?.material_costing_method || null,
            line_remark_1: poItem.line_remark_1,
            line_remark_2: poItem.line_remark_2,
            po_line_item_id: poItem.id,
            item_category_id: itemData?.item_category || null,
            uom_conversion: 0,
          };

          const isAltUOM = itemData?.table_uom_conversion?.find(
            (conv) =>
              conv.alt_uom_id === poItem.quantity_uom &&
              conv.alt_uom_id !== conv.base_uom_id
          );

          if (isAltUOM) {
            this.display([
              "table_gr.ordered_qty_uom",
              "table_gr.base_ordered_qty",
              "table_gr.base_ordered_qty_uom",
              "table_gr.to_received_qty_uom",
              "table_gr.base_received_qty_uom",
              "table_gr.base_received_qty",
              "table_gr.base_item_uom",
            ]);

            const baseQty = convertAltToBase(
              poItem.quantity,
              itemData.table_uom_conversion,
              poItem.quantity_uom
            );

            let baseReceivedQty = poItem.received_qty;
            if (poItem.received_qty > 0) {
              baseReceivedQty = convertAltToBase(
                poItem.received_qty,
                itemData.table_uom_conversion,
                poItem.quantity_uom
              );
            }

            newTableGrRecord.base_ordered_qty = baseQty;
            newTableGrRecord.base_ordered_qty_uom = itemData?.based_uom;
            newTableGrRecord.base_received_qty_uom = itemData?.based_uom;
            newTableGrRecord.base_item_uom = itemData?.based_uom;
            newTableGrRecord.base_received_qty = parseFloat(
              (baseQty - baseReceivedQty || 0).toFixed(3)
            );
            newTableGrRecord.uom_conversion = isAltUOM.alt_qty;
          }

          if (itemData?.serial_number_management === 1) {
            this.display("table_gr.select_serial_number");

            newTableGrRecord.is_serialized_item = 1;
          }

          if (itemData?.formula && itemData?.formula !== "") {
            this.display("table_gr.button_formula");

            newTableGrRecord.has_formula = 1;
            newTableGrRecord.formula = itemData?.formula;
          }

          if (itemData?.item_batch_management === 1) {
            this.display([
              "table_gr.manufacturing_date",
              "table_gr.expired_date",
            ]);
          }

          tableGR.push(newTableGrRecord);
        }
      }

      break;

    case "Item":
      for (const poItem of currentItemArray) {
        const newTableGrRecord = {
          item_id: poItem.item?.id || null,
          item_name: poItem.item?.material_name,
          item_desc: poItem.item_desc,
          more_desc: poItem.more_desc,
          ordered_qty: poItem.ordered_qty,
          ordered_qty_uom: poItem.item_uom || null,
          base_ordered_qty: poItem.ordered_qty,
          base_ordered_qty_uom: poItem.item_uom || null,
          base_item_uom: poItem.item_uom || null,
          base_received_qty_uom: poItem.item_uom || null,
          inspection_required:
            poItem.item?.receiving_inspection === 1 ? "Yes" : "No",
          to_received_qty: 0,
          to_received_qty_uom: poItem.item_uom || null,
          received_qty: parseFloat(
            (poItem.ordered_qty - (poItem.received_qty || 0)).toFixed(3)
          ),
          base_received_qty: parseFloat(
            (poItem.ordered_qty - (poItem.received_qty || 0)).toFixed(3)
          ),
          item_uom: poItem.item_uom || null,
          location_id: defaultBinLocationID,
          item_batch_no: poItem.item
            ? poItem.item?.item_batch_management === 0
              ? "-"
              : poItem.item?.batch_number_genaration ===
                "According To System Settings"
              ? "Auto-generated batch number"
              : ""
            : "-",
          inv_category: "",
          line_po_no: poItem.purchase_order.purchase_order_no,
          initial_received_qty: parseFloat(
            (poItem.received_qty || 0).toFixed(3)
          ),
          line_po_id: poItem.purchase_order.id,
          unit_price: poItem.unit_price,
          total_price: poItem.total_price,
          item_costing_method: poItem.item?.material_costing_method || null,
          line_remark_1: poItem.line_remark_1,
          line_remark_2: poItem.line_remark_2,
          po_line_item_id: poItem.purchase_order_line_id,
          item_category_id: poItem.item?.item_category || null,
          uom_conversion: 0,
        };

        console.log("poItem.item", poItem.item);
        console.log("poItem", poItem);

        if (poItem.alt_uom) {
          let poItemAltUOM = JSON.parse(poItem.alt_uom);
          if (typeof poItemAltUOM === "string") {
            poItemAltUOM = JSON.parse(poItemAltUOM);
          }
          poItemAltUOM = Array.isArray(poItemAltUOM)
            ? poItemAltUOM
            : [poItemAltUOM];
          console.log("poItemAltUOM", poItemAltUOM);

          const isAltUOM = poItemAltUOM?.find(
            (conv) =>
              conv.alt_uom_id === poItem.item_uom &&
              conv.alt_uom_id !== conv.base_uom_id
          );

          console.log("isAltUOM", isAltUOM);

          if (isAltUOM) {
            this.display([
              "table_gr.ordered_qty_uom",
              "table_gr.base_ordered_qty",
              "table_gr.base_ordered_qty_uom",
              "table_gr.to_received_qty_uom",
              "table_gr.base_received_qty_uom",
              "table_gr.base_received_qty",
              "table_gr.base_item_uom",
            ]);

            const baseQty = convertAltToBase(
              poItem.ordered_qty,
              poItemAltUOM,
              poItem.item_uom
            );

            let baseReceivedQty = poItem.received_qty;
            if (poItem.received_qty > 0) {
              baseReceivedQty = convertAltToBase(
                poItem.received_qty,
                poItemAltUOM,
                poItem.item_uom
              );
            }

            newTableGrRecord.base_ordered_qty = baseQty;
            newTableGrRecord.base_ordered_qty_uom = poItem.item.based_uom;
            newTableGrRecord.base_received_qty_uom = poItem.item.based_uom;
            newTableGrRecord.base_item_uom = poItem.item.based_uom;
            newTableGrRecord.base_received_qty = parseFloat(
              (baseQty - baseReceivedQty || 0).toFixed(3)
            );
            newTableGrRecord.uom_conversion = isAltUOM.alt_qty;
          }
        }

        if (poItem.item?.serial_number_management === 1) {
          this.display("table_gr.select_serial_number");

          newTableGrRecord.is_serialized_item = 1;
        }

        if (poItem.item?.formula && poItem.item?.formula !== "") {
          this.display("table_gr.button_formula");

          newTableGrRecord.has_formula = 1;
          newTableGrRecord.formula = poItem.item?.formula;
        }

        if (poItem.item?.item_batch_management === 1) {
          this.display([
            "table_gr.manufacturing_date",
            "table_gr.expired_date",
          ]);
        }

        tableGR.push(newTableGrRecord);

        purchaseOrderNumber.push(poItem.purchase_order.purchase_order_no);
        poId.push(poItem.purchase_order.id);
      }
      break;
  }

  tableGR = tableGR.filter(
    (gr) =>
      gr.received_qty !== 0 &&
      !existingGR.find(
        (grItem) => grItem.po_line_item_id === gr.po_line_item_id
      )
  );

  const latestTableGR = [...existingGR, ...tableGR];

  poId = [...new Set(latestTableGR.map((gr) => gr.line_po_id))];
  purchaseOrderNumber = [...new Set(latestTableGR.map((gr) => gr.line_po_no))];

  await this.setData({
    currency_code:
      referenceType === "Document"
        ? currentItemArray[0].currency
        : currentItemArray[0].purchase_order.po_currency,
    supplier_name:
      referenceType === "Document"
        ? currentItemArray[0].supplier_id
        : currentItemArray[0].purchase_order.po_supplier_id,
    table_gr: [...existingGR, ...tableGR],
    purchase_order_number: purchaseOrderNumber.join(", "),
    po_id: poId,
    reference_type: referenceType,
  });

  setTimeout(async () => {
    await processData(existingGR, tableGR, invCategoryData, putawaySetupData);
  }, 50);

  setTimeout(async () => {
    tableGR.forEach((gr, index) => {
      const rowIndex = existingGR.length + index;

      if (gr.is_serialized_item === 1) {
        this.disabled(`table_gr.${rowIndex}.received_qty`, true);
        this.disabled(`table_gr.${rowIndex}.base_received_qty`, true);
      } else {
        this.disabled(`table_gr.${rowIndex}.select_serial_number`, true);
        this.disabled(`table_gr.${rowIndex}.received_qty`, false);
        this.disabled(`table_gr.${rowIndex}.base_received_qty`, false);
      }

      if (gr.has_formula === 1) {
        this.disabled(`table_gr.${rowIndex}.button_formula`, false);
      } else {
        this.disabled(`table_gr.${rowIndex}.button_formula`, true);
      }
    });
  }, 100);

  this.hideLoading();
})();
