(async () => {
    const index = this.getValue(`confirm_split_dialog.rowIndex`)

    this.disabled([
        `table_gr.${index}.received_qty`,
        `table_gr.${index}.storage_location_id`,
        `table_gr.${index}.location_id`,
        `table_gr.${index}.remark`,
    ], false)

    await this.closeDialog('confirm_split_dialog');
})();