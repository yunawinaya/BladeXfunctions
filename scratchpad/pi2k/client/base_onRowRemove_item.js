(async () => {
  setTimeout(() => {
    (async () => {
      const tablePI = await this.getValue("table_pi");
      console.log("tablePI", tablePI);

      // table_pi is a tree: a bundle is one row with its items under `children`,
      // and those items reference a purchase order and a goods receiving of their
      // own. Read off the top level alone, removing a plain line could drop a
      // bundle item's PO or GR from the header while the item was still on the
      // invoice.
      const flattenPiRows = (rows) => {
        const flat = [];

        for (const row of rows || []) {
          flat.push(row);

          for (const child of Array.isArray(row.children) ? row.children : []) {
            flat.push(child);
          }
        }

        return flat;
      };

      const flatPI = flattenPiRows(tablePI);

      let poId = flatPI.map((pi) => pi.line_po_id);
      let purchaseOrderNumber = flatPI.map((pi) => pi.purchase_order_no);
      let grId = flatPI.map((pi) => pi.line_gr_id);
      let goodsReceivingNumber = flatPI.map((pi) => pi.goods_receiving_no);

      poId = [...new Set(poId)];
      purchaseOrderNumber = [...new Set(purchaseOrderNumber)];
      grId = [...new Set(grId)];
      goodsReceivingNumber = [...new Set(goodsReceivingNumber)];

      console.log(poId, purchaseOrderNumber);
      await this.setData({
        po_id: poId,
        po_no_display: purchaseOrderNumber.join(", "),
        gr_id: grId,
        gr_no_display: goodsReceivingNumber.join(", "),
      });

      await this.triggerEvent("PIcalculation");
    })();
  }, 50);
})();
