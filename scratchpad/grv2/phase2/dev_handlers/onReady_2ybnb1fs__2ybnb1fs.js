var params = this.getComponent('hu_no');
const { options } = params;
if(options?.canManualInput) {
  setTimeout(async()=> {
    const getOpData = await this.onDropdownVisible('hu_no_type', true)||[];
    const optionsData = this.getOptionData('hu_no_type') || [];
    let newData = getOpData?.length> 0? getOpData:optionsData;
      const newOptionsData = [{label: 'Manual Input', value: -9999}, ...newData];
      this.setOptionData("hu_no_type", newOptionsData);
  }, 200)
}
