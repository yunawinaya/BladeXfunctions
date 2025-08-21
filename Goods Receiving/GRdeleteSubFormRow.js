(async () => {
  setTimeout(() => {
    (async () => {
      const tableGR = await this.getValue("table_gr");
      console.log("tableGR", tableGR);
      let poId = tableGR.map((gr) => gr.line_po_id);
      let purchaseOrderNumber = tableGR.map((gr) => gr.line_po_no);

      poId = [...new Set(poId)];
      purchaseOrderNumber = [...new Set(purchaseOrderNumber)];

      console.log(poId, purchaseOrderNumber);
      await this.setData({
        po_id: poId,
        purchase_order_number: purchaseOrderNumber.join(", "),
      });
    })();
  }, 50);

  setTimeout(async () => {
    const tableGR = await this.getValue("table_gr");
    console.log("tableGR", tableGR);
    tableGR.forEach((gr, index) => {
      if (gr.is_serialized_item === 1) {
        this.disabled(`table_gr.${index}.received_qty`, true);
        this.disabled(`table_gr.${index}.base_received_qty`, true);
      } else {
        this.disabled(`table_gr.${index}.select_serial_number`, true);
        this.disabled(`table_gr.${index}.received_qty`, false);
        this.disabled(`table_gr.${index}.base_received_qty`, false);
      }
    });
  }, 100);
})();
