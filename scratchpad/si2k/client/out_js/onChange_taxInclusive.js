const data = this.getValues();
const value = arguments[0].value;
const updatedData = {};

if(data.acc_integration_type === 'AutoCount Accounting') {
  updatedData[`table_si.si_tax_inclusive`] = value
  this.setData(updatedData)
  // One recalculation for what was a full one per row and then the edited row,
  // each priced as the current row in turn (SIcalculation's { rows } payload).
  this.triggerEvent('SIcalculation', { rows: [...data.table_si, arguments[0].row] });
} else {
  this.triggerEvent('SIcalculation', { row: arguments[0].row });
}
