(async () => {
  setTimeout(() => {
    (async () => {
      const tableSI = await this.getValue("table_si");
      console.log("tableSI", tableSI);

      let soId = tableSI.map((gd) => gd.line_so_id);
      let salesOrderNumber = tableSI.map((gd) => gd.line_so_no);
      let gdId = tableSI.map((gd) => gd.line_gd_id);
      let goodsDeliveryNumber = tableSI.map((gd) => gd.line_gd_no);

      soId = [...new Set(soId)];
      salesOrderNumber = [...new Set(salesOrderNumber)];
      gdId = [...new Set(gdId)];
      goodsDeliveryNumber = [...new Set(goodsDeliveryNumber)];

      console.log(soId, salesOrderNumber);
      await this.setData({
        so_id: soId,
        so_no_display: salesOrderNumber.join(", "),
        gd_id: gdId,
        gd_no_display: goodsDeliveryNumber.join(", "),
      });

      // One recalculation for what was a full one per row, each row priced as
      // the current row in turn (SIcalculation's { rows } payload).
      if (tableSI.length > 0) {
        await this.triggerEvent("SIcalculation", { rows: tableSI });
      }
    })();
  }, 50);
})();
