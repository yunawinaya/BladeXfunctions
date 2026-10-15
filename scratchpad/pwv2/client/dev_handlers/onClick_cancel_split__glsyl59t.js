(async () => {
  const data = this.getValue('split_dialog');
  const isSplit = this.getValue(`table_putaway_item.${data.rowIndex}.is_split`);

  const putawayItem = this.getValue('table_putaway_item');

  if(isSplit && isSplit === 'Yes'){
      this.disabled([
          `table_putaway_item.${data.rowIndex}.putaway_qty`,
          `table_putaway_item.${data.rowIndex}.storage_location`,
          `table_putaway_item.${data.rowIndex}.target_location`,
          `table_putaway_item.${data.rowIndex}.remark`,
      ], false)

      this.setData({
          [`table_putaway_item.${data.rowIndex}.is_split`]: 'No'
      })
  }

  for(const [index, putaway] of putawayItem.entries()) {
    if(putaway.parent_or_child === 'Child') {
      this.disabled([
        `table_putaway_item.${index}.button_split`,
      ] , true)
    } else {
      this.disabled([
        `table_putaway_item.${index}.button_split`,
      ] , false)
    }
  }

  await this.triggerEvent('func_reset_split_dialog');
  await this.closeDialog('split_dialog');
})();