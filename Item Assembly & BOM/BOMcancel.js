if (this.parentGenerateForm) {
  this.parentGenerateForm.$refs.SuPageDialogRef.hide();
  this.parentGenerateForm.refresh();
  this.hideLoading();
}
