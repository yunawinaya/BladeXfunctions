const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  this.showLoading("Saving Sales Invoice...");
  let data = this.getValues();

  await db.collection('sales_invoice').doc(data.id).update(data)
  closeDialog();
})();
