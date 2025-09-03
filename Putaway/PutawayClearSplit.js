(async () => {
    const data = this.getValues();

    const rowIndex = this.getValue(`confirm_split_dialog.rowIndex`);

    const tablePutawayItem = data.table_putaway_item;

    await this.openDialog('split_dialog');
    await this.closeDialog('confirm_split_dialog');

    await this.setData({
        [`split_dialog.item_id`]: tablePutawayItem[rowIndex].item_code,
        [`split_dialog.item_name`]: tablePutawayItem[rowIndex].item_name,
        [`split_dialog.qty_to_putaway`]: tablePutawayItem[rowIndex].qty_to_putaway,
        [`split_dialog.rowIndex`]: rowIndex
    })

    if (tablePutawayItem[rowIndex].is_serialized_item === 1) {
        await this.display("split_dialog.table_split.select_serial_number");
        await this.setData({
            [`split_dialog.serial_number_data`]: tablePutawayItem[rowIndex].serial_numbers,
        });
    } else {
        await this.hide("split_dialog.table_split.select_serial_number");
    }

    const latestPutawaytItem = tablePutawayItem.filter(item => !(item.parent_or_child === 'Child' && item.parent_index === rowIndex));
    
    await this.setData({table_putaway_item: latestPutawaytItem})
})();