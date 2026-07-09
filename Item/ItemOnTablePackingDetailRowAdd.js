(async () => {
  try {
    const basedUOM = this.getValue("based_uom");
    if (!basedUOM) return;

    const tablePackingDetail = this.getValue("table_packing_detail") || [];
    if (tablePackingDetail.length === 0) return;

    const rowIndex = tablePackingDetail.length - 1;
    const newRow = tablePackingDetail[rowIndex] || {};

    this.setData({
      ...(newRow.uom_id
        ? {}
        : { [`table_packing_detail.${rowIndex}.uom_id`]: basedUOM }),
      ...(newRow.packing_uom_id
        ? {}
        : { [`table_packing_detail.${rowIndex}.packing_uom_id`]: basedUOM }),
    });
  } catch (error) {
    console.error("Error in packing detail row add:", error);
  }
})();
