const self = this;
const allData = self.getValues();
const processSource = arguments[0].value;
const pageStatus = this.getValue("page_status");
const productionOrderId = self.getValue("id");
const plantId = allData.plant_id;

if (processSource) {
  this.display(["card_details"]);
  this.display(["table_process_route"]);
  this.display(["card_bom"]);
} else {
  this.hide(["card_details"]);
  this.hide(["table_process_route"]);
  this.hide(["card_bom"]);
}

if (pageStatus === "Edit" || pageStatus === "View") {
  db.collection("production_order")
    .where({ id: productionOrderId })
    .get()
    .then((response) => {
      const productionOrderData = response.data[0];
      const productionProcessId = productionOrderData.process_source;

      if (processSource && processSource !== productionProcessId) {
        this.setData({ [`table_process_route`]: [] });
        this.setData({ [`table_bom`]: [] });
      } else {
        self.setData({
          table_process_route: productionOrderData.table_process_route,
          table_bom: productionOrderData.table_bom,
        });
      }
    });
} else {
  if (processSource === "Custom Process") {
    this.display("grid_9gn5igyx");
  } else {
    this.hide("grid_9gn5igyx");
  }
  this.setData({ [`table_process_route`]: [] });
  this.setData({ [`table_bom`]: [] });
}
