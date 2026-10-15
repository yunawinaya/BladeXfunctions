(async () => {
  const poIDs = arguments[0].value;

  if(poIDs.length > 0) {
    const firstPO = poIDs[0];

    const resPO = await db.collection('purchase_order').doc(firstPO).get();

    const poData = resPO.data[0];

    this.setData({
      gr_remark1: poData.po_remark,
      gr_remark2: poData.po_remark2,
      gr_remark3: poData.po_remark3,
    })
  }
})();