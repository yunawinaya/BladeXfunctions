const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};


(async () => {
    try{
        this.showLoading();
        const data = this.getValues();
    
        const resPutAwaySetup = await db.collection("putaway_setup").where({ plant_id: data.plant_id, movement_type: 'Good Receiving' }).get();
        const putAwaySetupData = resPutAwaySetup?.data[0];
    
        if(putAwaySetupData && putAwaySetupData.putaway_required === 1){
            if(data.putaway_status !== 'Completed') {
                throw new Error('Putaway is not completed.');
            }
        } 

        await db.collection('goods_receiving').where({ id: data.id }).update({ gr_status: 'Completed' });
        await closeDialog();
    } catch (error){
        this.hideLoading();
        this.$message.error(error.message ||String(error));
    }
})();