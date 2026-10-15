const viewOnly =
  arguments[0].row.line_status === "Processing" ||
  arguments[0].row.line_status === "Completed" ||
  arguments[0].row.item_bundle_id ||
  this.isView;

this.toView({
  target: '2051491208093147137',
  targetType: 'Page',
  mode: 'dialog',
  type: viewOnly ? "view" : "add",
  title: 'Price History',
  params: { 
    item_id: arguments[0].row.item_id,
    plant_id: this.getValue('po_plant'), 
    supplier_id: this.getValue('po_supplier_id'), 
    organization_id: this.getValue('organization_id'),
    index: arguments[0].row.fm_key,
  }
});