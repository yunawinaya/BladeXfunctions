(async () => {
    const index = this.getValue(`confirm_split_dialog.rowIndex`)

    this.disabled([
        `table_putaway_item.${index}.putaway_qty`,
        `table_putaway_item.${index}.storage_location`,
        `table_putaway_item.${index}.target_location`,
        `table_putaway_item.${index}.remark`,
    ], false)

    await this.closeDialog('confirm_split_dialog');
})();