(async () => {
  const referenceType = this.getValue(`dialog_select_item.reference_type`);
  const currentItemArray = this.getValue(`dialog_select_item.item_array`);
  let existingSR = this.getValue("table_sr");
  const previousReferenceType = this.getValue("reference_type");

  let tableSR = [];
  let salesOrderNumber = [];
  let soId = [];
  let goodsDeliveryNumber = [];
  let gdId = [];

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one goods delivery / item.", "Error", {
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

    existingSR = [];
  }

  const uniqueCustomers = new Set(currentItemArray.map((gd) => gd.customer_id));
  const allSameCustomer = uniqueCustomers.size === 1;

  if (!allSameCustomer) {
    this.$alert(
      "Returned item(s) from more than two different customers is not allowed.",
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

  switch (referenceType) {
    case "Document":
      for (const gd of currentItemArray) {
        for (const gdItem of gd.table_gd) {
          const newtableSRRecord = {
            material_id: gdItem.material_id || null,
            material_name: gdItem.material_name,
            material_desc: gdItem.gd_material_desc || "",
            item_category_id: gdItem.item_category_id || null,

            more_desc: gdItem.more_desc || "",
            line_remark_1: gdItem.line_remark_1 || "",
            line_remark_2: gdItem.line_remark_2 || "",

            line_so_no: gdItem.line_so_no,
            gd_number: gd.delivery_no,
            so_id: gdItem.line_so_id,
            so_line_id: gdItem.so_line_item_id,
            gd_id: gd.goods_delivery_id,
            gd_line_id: gdItem.id,

            so_quantity: parseFloat(gdItem.gd_order_quantity || 0),
            good_delivery_qty: parseFloat(gdItem.gd_qty || 0),
            to_returned_qty:
              parseFloat(gdItem.gd_qty || 0) -
              parseFloat(gdItem.return_qty || 0),
            quantity_uom: gdItem.good_delivery_uom_id,
            unit_price: gdItem.unit_price,
            total_price: gdItem.total_price,
            fifo_sequence: gdItem.fifo_sequence,
            costing_method: gdItem.item_costing_method,
            temp_qty_data: gdItem.temp_qty_data,
          };

          tableSR.push(newtableSRRecord);
        }
      }

      break;

    case "Item":
      for (const gdItem of currentItemArray) {
        const newtableSRRecord = {
          material_id: gdItem.item.id || null,
          material_name: gdItem.item.material_name,
          material_desc: gdItem.gd_material_desc || "",
          item_category_id: gdItem.item.item_category || null,

          more_desc: gdItem.more_desc || "",
          line_remark_1: gdItem.line_remark_1 || "",
          line_remark_2: gdItem.line_remark_2 || "",

          line_so_no: gdItem.sales_order_id.so_no,
          gd_number: gdItem.goods_delivery_id.delivery_no,
          so_id: gdItem.sales_order_id.id,
          so_line_id: gdItem.sales_order_line_id.id,
          gd_id: gdItem.goods_delivery_id.id,
          gd_line_id: gdItem.goods_delivery_line_id,

          so_quantity: parseFloat(gdItem.gd_order_quantity || 0),
          good_delivery_qty: parseFloat(gdItem.gd_qty || 0),
          to_returned_qty:
            parseFloat(gdItem.gd_qty || 0) - parseFloat(gdItem.return_qty || 0),
          quantity_uom: gdItem.good_delivery_uom_id,
          unit_price: gdItem.unit_price,
          total_price: gdItem.total_price,
          fifo_sequence: gdItem.fifo_sequence,
          costing_method: gdItem.item_costing_method,
          temp_qty_data: gdItem.temp_qty_data,
        };

        tableSR.push(newtableSRRecord);
      }
      break;
  }

  tableSR = tableSR.filter(
    (sr) =>
      sr.to_returned_qty !== 0 &&
      !existingSR.find((srItem) => srItem.gd_line_id === sr.gd_line_id)
  );

  const latesttableSR = [...existingSR, ...tableSR];
  console.log("latesttableSR", latesttableSR);

  soId = [...new Set(latesttableSR.map((sr) => sr.so_id))];
  salesOrderNumber = [...new Set(latesttableSR.map((sr) => sr.line_so_no))];
  gdId = [...new Set(latesttableSR.map((sr) => sr.gd_id))];
  goodsDeliveryNumber = [...new Set(latesttableSR.map((sr) => sr.gd_number))];

  await this.setData({
    customer_id: currentItemArray[0].customer_id,
    table_sr: [...existingSR, ...tableSR],
    so_no_display: salesOrderNumber.join(", "),
    so_id: soId,
    gd_no_display: goodsDeliveryNumber.join(", "),
    gd_id: gdId,
    reference_type: referenceType,
  });

  this.hideLoading();
})();
