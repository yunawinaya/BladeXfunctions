// Replace with the deployed workflow id.
const CREDIT_RELOAD_SAVE_WORKFLOW_ID = 'REPLACE_WITH_WORKFLOW_ID';

(async () => {
  try {
    this.showLoading('Saving Credit Reload...');

    const data = this.getValues();
    data.mode = 'form';

    await this.runWorkflow(
      CREDIT_RELOAD_SAVE_WORKFLOW_ID,
      { data },
      () => {
        this.$message.success(this.isEdit ? 'Update successfully' : 'Add successfully');
        this.hideLoading();

        if (this.parentGenerateForm) {
          this.parentGenerateForm.$refs.SuPageDialogRef.hide();
          this.parentGenerateForm.refresh();
        }
      },
      (error) => {
        this.hideLoading();
        console.error('Credit Reload save failed', error);
        this.$message.error(error?.data?.msg || 'An error occurred');
      },
    );
  } catch (error) {
    this.hideLoading();
    console.error('Credit Reload save failed', error);
    this.$message.error(error?.data?.msg || 'An error occurred');
  }
})();
