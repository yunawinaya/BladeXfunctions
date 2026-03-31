const checkExistingPOinPI = async (grArray) => {
  const grNumbersWithPI = new Set(); // Use Set to avoid duplicates

  await Promise.all(
    grArray.flatMap((gr) =>
      gr.purchase_order_id.map((poId) =>
        db
          .collection("purchase_invoice")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "po_id", operator: "in", value: poId.id },
                { prop: "gr_no_display", operator: "isNull", value: null },
              ],
            },
          ])
          .get()
          .then((response) => {
            if (response.data[0]) {
              // Only add GR number if PI exists
              grNumbersWithPI.add(gr.goods_receiving_number);
            }
          }),
      ),
    ),
  );

  console.log("GR numbers with existing PIs:", Array.from(grNumbersWithPI));
  return Array.from(grNumbersWithPI);
};

const fetchPOLineItemData = async (poLineItemIDs) => {
  const resPOLineItem = await Promise.all(
    poLineItemIDs.map((lineId) =>
      db.collection("purchase_order_2ukyuanr_sub").doc(lineId).get(),
    ),
  );

  const poLineItemData = resPOLineItem.map((response) => response.data[0]);
  return poLineItemData;
};

const processData = async (tablePI, referenceType) => {
  this.display("po_no_display");
  if (referenceType.endsWith("GR")) {
    this.display("gr_no_display");
  } else {
    this.hide("gr_no_display");
  }

  for (const [index, pi] of tablePI.entries()) {
    if (pi.tax_percent && pi.tax_percent >= 0) {
      this.disabled([`table_pi.${index}.tax_percent`], false);
    } else {
      this.disabled([`table_pi.${index}.tax_percent`], true);
    }

    if (referenceType.endsWith("GR")) {
      this.display(`table_pi.goods_receiving_no`);
    } else {
      this.hide(`table_pi.goods_receiving_no`);
    }
  }
};

(async () => {
  const previousReferenceType = this.getValue("reference_type");
  const referenceType = this.getValue(`dialog_select_item.reference_type`);
  const currentItemArray = this.getValue(`dialog_select_item.item_array`);

  let existingPI = this.getValue("table_pi");

  const supplierName = this.getValue("supplier_name");

  let tablePI = [];
  let purchaseOrderNumber = [];
  let poId = [];
  let goodsReceivingNumber = [];
  let grId = [];

  if (currentItemArray.length === 0) {
    this.$alert(
      "Please select at least one purchase order / goods receiving / item.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );

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

    existingPI = [];
  }

  const uniqueSuppliers = new Set(
    currentItemArray.map((item) =>
      referenceType.startsWith("Document")
        ? item.supplier_id
        : item.supplier.id,
    ),
  );
  const allSameSupplier = uniqueSuppliers.size === 1;

  if (!allSameSupplier) {
    this.$alert(
      "Invoiced item(s) from more than two different suppliers is not allowed.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      },
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
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    existingPI = [];
  }

  if (referenceType === "Document - GR" || referenceType === "Item - GR") {
    const existingGRNumbers = await checkExistingPOinPI(currentItemArray);

    if (existingGRNumbers && existingGRNumbers.length > 0) {
      this.parentGenerateForm.$alert(
        `Purchase Order(s) in the ${existingGRNumbers.join(
          ", ",
        )} has existing Purchase Invoice(s). Please choose different Goods Receiving(s).`,
        "Existing Purchase Invoice(s) Detected",
        {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: false,
        },
      );

      this.hideLoading();
      return;
    }
  }
  this.closeDialog("dialog_select_item");
  this.showLoading();

  switch (referenceType) {
    case "Document - PO":
      for (const po of currentItemArray) {
        for (const poItem of po.table_po) {
          const newTablePIRecord = {
            material_id: poItem.item_id || "",
            material_name: poItem.item_name,
            item_desc: poItem.item_desc || "",
            purchase_order_no: po.purchase_order_number,
            order_qty: poItem.quantity,
            more_desc: poItem.more_desc || "",
            line_remark_1: poItem.line_remark_1 || "",
            line_remark_2: poItem.line_remark_2 || "",
            received_qty: poItem.received_qty,
            invoice_qty: poItem.quantity - poItem.invoice_qty,
            quantity_uom: poItem.quantity_uom,
            order_unit_price: poItem.unit_price,
            order_discount: poItem.discount,
            discount_uom: poItem.discount_uom,
            tax_percent: poItem.tax_percent,
            tax_preference: poItem.tax_preference,
            tax_inclusive: poItem.tax_inclusive,
            po_line_id: poItem.id,
            gr_line_id: "",
            available_inv_qty: poItem.quantity - poItem.invoice_qty,
            line_po_id: po.purchase_order_id,
            line_gr_id: "",
            item_category_id: poItem.item_category_id,
          };

          tablePI.push(newTablePIRecord);
        }
      }

      break;

    case "Document - GR":
      for (const gr of currentItemArray) {
        // Filter out child rows - only count parent/regular/split-parent rows for invoicing
        // Child rows are inventory-level detail (per-bin, per-HU); parent has the total received_qty
        const grLines = gr.table_gr.filter(
          (item) => item.parent_or_child !== "Child",
        );

        const poLineItemIDs = grLines.map((item) => item.po_line_item_id);

        const poLineItemData = await fetchPOLineItemData(poLineItemIDs);
        console.log("poLineItemData", poLineItemData);
        for (const [index, grItem] of grLines.entries()) {
          const newTablePIRecord = {
            material_id: grItem.item_id || "",
            material_name: grItem.item_name,
            item_desc: grItem.item_desc || "",
            more_desc: grItem.more_desc || "",
            order_qty: grItem.ordered_qty,
            received_qty: grItem.received_qty,
            purchase_order_no: grItem.line_po_no,
            goods_receiving_no: gr.goods_receiving_number,
            line_remark_1: grItem.line_remark_1 || "",
            line_remark_2: grItem.line_remark_2 || "",
            invoice_qty: grItem.received_qty - (grItem.invoice_qty || 0),
            quantity_uom: grItem.item_uom,
            order_unit_price: grItem.unit_price,
            order_discount: poLineItemData[index].discount,
            discount_uom: poLineItemData[index].discount_uom,
            tax_percent: poLineItemData[index].tax_percent,
            tax_preference: poLineItemData[index].tax_preference,
            tax_inclusive: poLineItemData[index].tax_inclusive,
            gr_line_id: grItem.id,
            po_line_id: grItem.po_line_item_id,
            available_inv_qty: grItem.received_qty - (grItem.invoice_qty || 0),
            line_po_id: grItem.line_po_id,
            line_gr_id: gr.goods_receiving_id,
            item_category_id: grItem.item_category_id,
          };

          tablePI.push(newTablePIRecord);
        }
      }
      break;

    case "Item - PO":
      for (const poItem of currentItemArray) {
        const newTablePIRecord = {
          material_id: poItem.item.id || "",
          material_name: poItem.item.material_name,
          item_desc: poItem.item_desc || "",
          purchase_order_no: poItem.purchase_order.purchase_order_no,
          order_qty: poItem.ordered_qty,
          more_desc: poItem.more_desc || "",
          line_remark_1: poItem.line_remark_1 || "",
          line_remark_2: poItem.line_remark_2 || "",
          received_qty: poItem.received_qty,
          invoice_qty: poItem.ordered_qty - poItem.invoice_qty,
          quantity_uom: poItem.item_uom,
          order_unit_price: poItem.unit_price,
          order_discount: poItem.order_discount,
          discount_uom: poItem.discount_uom,
          tax_percent: poItem.tax_percent,
          tax_preference: poItem.tax_preference,
          tax_inclusive: poItem.tax_inclusive,
          po_line_id: poItem.purchase_order_line_id,
          gr_line_id: "",
          available_inv_qty: poItem.ordered_qty - poItem.invoice_qty,
          line_po_id: poItem.purchase_order.id,
          line_gr_id: "",
          item_category_id: poItem.item.item_category,
        };

        tablePI.push(newTablePIRecord);
      }
      break;

    case "Item - GR":
      for (const grItem of currentItemArray.filter(
        (item) => item.parent_or_child !== "Child",
      )) {
        const newTablePIRecord = {
          material_id: grItem.item.id || "",
          material_name: grItem.item.material_name,
          item_desc: grItem.item_desc || "",
          more_desc: grItem.more_desc || "",
          order_qty: grItem.ordered_qty,
          received_qty: grItem.received_qty,
          purchase_order_no: grItem.line_po_no,
          goods_receiving_no: grItem.goods_receiving_number,
          line_remark_1: grItem.line_remark_1 || "",
          line_remark_2: grItem.line_remark_2 || "",
          invoice_qty: grItem.received_qty - (grItem.invoiced_qty || 0),
          quantity_uom: grItem.uom,
          order_unit_price: grItem.po_line_item.unit_price,
          order_discount: grItem.po_line_item.discount,
          discount_uom: grItem.po_line_item.discount_uom,
          tax_percent: grItem.po_line_item.tax_percent,
          tax_preference: grItem.po_line_item.tax_preference,
          tax_inclusive: grItem.po_line_item.tax_inclusive,
          gr_line_id: grItem.goods_receiving_line_id,
          po_line_id: grItem.po_line_item.id,
          available_inv_qty: grItem.received_qty - (grItem.invoiced_qty || 0),
          line_po_id: grItem.line_po_id,
          line_gr_id: grItem.goods_receiving_id,
          item_category_id: grItem.item_category_id,
        };

        tablePI.push(newTablePIRecord);
      }
      break;
  }

  tablePI = tablePI.filter(
    (pi) =>
      pi.invoice_qty !== 0 &&
      !existingPI.find((piItem) => piItem.po_line_id === pi.po_line_id),
  );

  const latestTablePI = [...existingPI, ...tablePI];

  poId = [...new Set(latestTablePI.map((pi) => pi.line_po_id))];
  purchaseOrderNumber = [
    ...new Set(latestTablePI.map((pi) => pi.purchase_order_no)),
  ];

  grId = [...new Set(latestTablePI.map((pi) => pi.line_gr_id))];
  goodsReceivingNumber = [
    ...new Set(latestTablePI.map((pi) => pi.goods_receiving_no)),
  ];

  console.log("tablePI", tablePI);
  await this.setData({
    supplier_name: referenceType.startsWith("Document")
      ? currentItemArray[0].supplier_id
      : currentItemArray[0].supplier.id,
    table_pi: [...existingPI, ...tablePI],
    po_no_display: purchaseOrderNumber.join(", "),
    po_id: poId,
    gr_no_display: goodsReceivingNumber.join(", "),
    gr_id: grId,
    reference_type: referenceType,
  });

  setTimeout(async () => {
    await processData(tablePI, referenceType);
  }, 50);

  this.triggerEvent("PIcalculation", { PIlineItem: tablePI });
  this.triggerEvent("onChange_supplier");

  this.hideLoading();
})();
