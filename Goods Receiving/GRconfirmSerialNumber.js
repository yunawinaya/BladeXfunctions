(async () => {
  const dialogData = this.getValue("dialog_serial_number");

  console.log("Original dialogData:", dialogData);

  // Map to extract only useful data
  const mappedData = {
    // Item Information
    row_index: dialogData.row_index,
    item_id: dialogData.item_id,
    item_code: dialogData.item_code,
    item_name: dialogData.item_name,
    item_image_url: dialogData.item_image_url || "",

    // Quantity Information
    serial_number_qty: dialogData.serial_number_qty,
    total_quantity: dialogData.total_quantity,
    total_quantity_uom: dialogData.total_quantity_uom,
    total_quantity_uom_id: dialogData.total_quantity_uom_id,
    total_qty_display: dialogData.total_qty_display,

    // Serial Number Configuration
    is_auto: dialogData.is_auto,
    is_single: dialogData.is_single,
    new_rows: dialogData.new_rows,

    // Serial Number Table (clean version)
    table_serial_number:
      dialogData.table_serial_number?.map((item) => ({
        system_serial_number: item.system_serial_number,
        supplier_serial_number: item.supplier_serial_number,
        serial_quantity: item.serial_quantity,
        fm_key: item.fm_key,
      })) || [],
  };

  await this.setData({
    [`table_gr.${dialogData.row_index}.serial_number_data`]:
      JSON.stringify(mappedData),
  });
})();
