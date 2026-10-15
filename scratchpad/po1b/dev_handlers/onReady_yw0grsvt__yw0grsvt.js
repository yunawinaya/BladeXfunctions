var params = this.getComponent('purchase_order_no');
const { options } = params;
if(options?.canManualInput && this.isEdit) {
  setTimeout(async()=> {
    const getOpData = await this.onDropdownVisible('purchase_order_no_type', true)||[];
    const optionsData = this.getOptionData('purchase_order_no_type') || [];
    let newData = getOpData?.length> 0? getOpData:optionsData;
      const newOptionsData = [{label: 'Manual Input', value: -9999}, ...newData];
      this.setOptionData("purchase_order_no_type", newOptionsData);
  }, 200)
}