const self = this;
const processSource = arguments[0].value;
const pageStatus = this.getValue("page_status");
const productionOrderId = self.getValue("id");
const materialId = self.getValue("material_id");

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
  this.setData({
    [`table_process_route`]: [],
    [`table_bom`]: [],
    process_route_no: "",
    process_route_name: "",
    bom_id: "",
  });

  if (processSource === "Process Route") {
    await db
      .collection("process_route")
      .where({ material_code: materialId, is_main_process_route: 1 })
      .get()
      .then((response) => {
        const processRouteData = response.data[0];
        console.log("processRouteData JN", processRouteData);
        self.setData({
          process_route_no: processRouteData.id,
        });
      });
  }
}
