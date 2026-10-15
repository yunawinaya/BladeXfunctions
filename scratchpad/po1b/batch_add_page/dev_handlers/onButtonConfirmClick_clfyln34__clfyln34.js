(async () => {
  const itemArray = this.getValue('item_array');
  this.parentGenerateForm.$refs.SuPageDialogRef.hide();
  this.parentGenerateForm.triggerEvent('onConfirm_batchAddItem', {itemArray})
})();