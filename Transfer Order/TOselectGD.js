(async () => {
  try {
    const gdNo = await this.getValue("gd_no");

    const gdData = await db
      .collection("goods_delivery")
      .where({ id: gdNo })
      .get()
      .then((response) => {
        if (response.data && response.data.length > 0) {
          return response.data[0];
        }
        return null;
      });

    let tablePickingItems = [];

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    gdData.table_gd.forEach((item) => {
      if (item.temp_qty_data) {
        try {
          const tempData = JSON.parse(item.temp_qty_data);
          tempData.forEach((tempItem) => {
            tablePickingItems.push({
              item_code: item.material_id,
              item_name: item.material_name,
              item_desc: item.gd_material_desc || "",
              batch_no: tempItem.batch_id,
              qty_to_pick: parseFloat(tempItem.gd_quantity),
              item_uom: item.gd_order_uom_id,
              pending_process_qty: parseFloat(tempItem.gd_quantity),
              bin_location_id: tempItem.location_id,
              line_status: "Open",
            });
          });
        } catch (error) {
          console.error(
            `Error parsing temp_qty_data for new TO: ${error.message}`
          );
        }
      }
    });

    this.setData({
      table_picking_items: tablePickingItems,
      created_by: this.getVarGlobal("nickname"),
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      organization_id: organizationId,
    });
  } catch (error) {
    console.error("Error fetching Goods Delivery:", error);
  }
})();
