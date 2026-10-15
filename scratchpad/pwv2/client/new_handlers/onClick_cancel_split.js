(async () => {
  const data = this.getValue('split_dialog');
  const isSplit = this.getValue(`table_putaway_item.${data.rowIndex}.is_split`);

  if(isSplit && isSplit === 'Yes'){
      // also the two cells the split locked that the column leaves open (a later split re-keyed them open before)
      this.disabled([
          `table_putaway_item.${data.rowIndex}.putaway_qty`,
          `table_putaway_item.${data.rowIndex}.storage_location`,
          `table_putaway_item.${data.rowIndex}.target_location`,
          `table_putaway_item.${data.rowIndex}.remark`,
          `table_putaway_item.${data.rowIndex}.target_inv_category`,
          `table_putaway_item.${data.rowIndex}.select_serial_number`,
      ], false)

      this.setData({
          [`table_putaway_item.${data.rowIndex}.is_split`]: 'No'
      })
  }

  // rows keep their split-button state; the old per-row pass also re-enabled it on HU / bundle rows

  await this.triggerEvent('func_reset_split_dialog');
  await this.closeDialog('split_dialog');
})();
