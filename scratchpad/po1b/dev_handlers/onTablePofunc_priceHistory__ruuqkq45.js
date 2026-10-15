this.toView({
  target: '2051489663502950401',
  targetType: 'Page',
  mode: 'dialog',
  type: this.isView ? "view" : "add",
  title: 'Price History',
  params: { 
    plant_id: this.getValue('po_plant'), 
    supplier_id: this.getValue('po_supplier_id'), 
    organization_id: this.getValue('organization_id')
  }
});