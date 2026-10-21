(async () => {
  const data = this.getValues();
  this.setData({
    goods_delivery_number: [],
    table_si: [],
  });

  const salesOrderId = data.so_id;
  if (salesOrderId.length === 0) {
    this.setData({
      si_payment_term_id: "",
      exchange_rate: "",
      si_description: "",
      remarks: "",

      invoice_subtotal: 0,
      invoice_total_discount: 0,
      invoice_taxes_amount: 0,
      invoice_total: 0,
      myr_total_amount: 0,
    });
    return;
  }

  try {
    console.log("Sales Order ID:", salesOrderId);

    const resSO = await Promise.all(
      salesOrderId.map((soId) => db.collection("sales_order").doc(soId).get())
    );
    console.log("Sales orders:", resSO);

    const soData = resSO.map((response) => response.data[0]);
    console.log("Sales order data:", soData);

    const displayText = soData
      .map((so) => so?.so_no)
      .filter(Boolean)
      .join(", ");

    this.setData({ so_no_display: displayText });

    // Create a single array for all line items across all SOs
    let tableSI = [];

    if (salesOrderId.length > 1) {
      this.disabled("goods_delivery_number", true);
    } else {
      this.disabled("goods_delivery_number", false);
    }

    // Process each so
    for (const so of soData) {
      const soLineItemData = so.table_so || [];
      console.log("soLineItemData for so:", so.so_no, soLineItemData);

      // Process each line item
      if (soLineItemData.length > 0) {
        for (const soItem of soLineItemData) {
          console.log("Processing so item:", soItem);
          const siItemData = {
            material_id: soItem.item_name || "",
            line_so_id: so.id,
            material_name: soItem.item_id,
            material_desc: soItem.so_desc || "",

            more_desc: soItem.more_desc || "",
            line_remark_1: soItem.line_remark_1 || "",
            line_remark_2: soItem.line_remark_2 || "",

            line_so_no: so.so_no,
            so_order_quantity: soItem.so_quantity,
            so_order_uom_id: soItem.so_item_uom,
            good_delivery_quantity: soItem.delivered_qty,
            invoice_qty: soItem.so_quantity - (soItem.invoice_qty || 0),
            invoice_qty_uom_id: soItem.so_item_uom,
            unit_price: soItem.so_item_price,
            si_discount: soItem.so_discount,
            si_discount_uom_id: soItem.so_discount_uom,
            si_tax_rate_id: soItem.so_tax_preference,
            tax_rate_percent: soItem.so_tax_percentage,
            si_tax_inclusive: soItem.so_tax_inclusive,

            // Add additional fields from so
          };

          tableSI.push(siItemData);
        }
      }
    }

    // Set the data after processing all sos
    if (tableSI.length > 0) {
      await this.setData({ table_si: tableSI });

      setTimeout(() => {
        tableSI.forEach((item, lineItemIndex) => {
          if (item.tax_rate_percent && item.tax_rate_percent >= 0) {
            this.disabled(
              [`table_si.${lineItemIndex}.tax_rate_percent`],
              false
            );
          }
        });
      }, 1000);

      this.triggerEvent("SIcalculation", { SIlineItem: tableSI });
    }
  } catch (error) {
    this.$message.error(error.toString());
  }
})();
