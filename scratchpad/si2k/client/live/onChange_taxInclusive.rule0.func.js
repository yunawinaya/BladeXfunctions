const data = this.getValues();
const value = arguments[0].value;
const updatedData = {};

if(data.acc_integration_type === 'AutoCount Accounting') {
  updatedData[`table_si.si_tax_inclusive`] = value
  this.setData(updatedData)
  for(const item of data.table_si) {
    this.triggerEvent('SIcalculation', { row: item });
  }
}
this.triggerEvent('SIcalculation', { row: arguments[0].row });
