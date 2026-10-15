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

  // Line states are kept per line (the table keys them by fm_key), so removing
  // a line moves nothing and nothing is re-applied here.
})();
