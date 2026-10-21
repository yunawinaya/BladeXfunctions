if (this.getValue("si_status") == "Completed") {
  return
}

this.toView({
  target: '2041000327701270530',
  targetType: 'Page',
  mode: 'dialog',
  type: 'add',
  title: 'Batch Add',
  params: { 'plant_id': this.getValue('plant_id') }
});