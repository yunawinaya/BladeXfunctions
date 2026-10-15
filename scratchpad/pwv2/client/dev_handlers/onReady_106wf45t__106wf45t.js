var params = this.getComponent('to_id');
const { options } = params;
if(options?.canManualInput && this.isEdit) {
  setTimeout(async()=> {
    const getOpData = await this.onDropdownVisible('to_id_type', true)||[];
    const optionsData = this.getOptionData('to_id_type') || [];
    let newData = getOpData?.length> 0? getOpData:optionsData;
      const newOptionsData = [{label: 'Manual Input', value: -9999}, ...newData];
      this.setOptionData("to_id_type", newOptionsData);
  }, 200)
}
