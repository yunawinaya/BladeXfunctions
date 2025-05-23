const self = this;
const allData = self.getValues();
const processId = arguments[0].value;
const source = allData.process_source;
const allDateProcessId = allData.process_route_no;
const pageStatus = self.getValue("page_status");
const productionOrderId = self.getValue("id");
const plantId = allData.plant_id;
// console.log("pageStatus", pageStatus);

if (pageStatus === "Edit" || pageStatus === "View") {
  db.collection("production_order")
    .where({ id: productionOrderId })
    .get()
    .then((response) => {
      const productionOrderData = response.data[0];
      const productionProcessId = productionOrderData.process_route_no;

      if (processId && processId !== productionProcessId) {
        fetchAndMapProcessData(processId);
      } else {
        self.setData({
          table_bom: productionOrderData.table_bom || [],
          process_route_name: productionOrderData.process_route_name,
          table_process_route: productionOrderData.table_process_route || [],
        });
      }
    });
} else {
  db.collection("process_route")
    .where({ id: processId })
    .get()
    .then((response) => {
      const processData = response.data[0];
      const processList = processData.process_table;
      const materialList = processData.mat_consumption_table;

      const mappedBomData = materialList.map((item) => ({
        material_id: item.bom_material_code,
        material_name: item.bom_material_name,
        material_category: item.bom_material_category,
        material_quantity: item.quantity,
      }));

      const mappedProcessData = processList.map((item) => ({
        process_id: item.process_no,
        process_name: item.process_name,
        process_category: item.process_category,
      }));

      self.setData({
        table_bom: mappedBomData || [],
        process_route_name: processData.process_route_name,
        table_process_route: mappedProcessData || [],
      });

      // console.log("processList", processList);
    })
    .catch((error) => {
      console.error("Error fetching process route:", error);
    });
}

// Extracted method to avoid code duplication
const fetchAndMapProcessData = function (processId, pageStatus = null) {
  // Add optional pageStatus parameter
  db.collection("process_route")
    .where({ id: processId })
    .get()
    .then((response) => {
      const processData = response.data[0];
      const processList = processData.process_table;
      const materialList = processData.mat_consumption_table;

      const mappedBomData = materialList.map((item) => ({
        material_id: item.bom_material_code,
        material_name: item.bom_material_name,
        material_category: item.bom_material_category,
        material_quantity: item.quantity,
        item_process_id: item.item_process_id,
      }));

      const mappedProcessData = processList.map((item) => ({
        process_id: item.process_no,
        process_name: item.process_name,
        process_category: item.process_category,
      }));

      self.setData({
        table_bom: mappedBomData || [],
        process_route_name: processData.process_route_name,
        table_process_route: mappedProcessData || [],
      });

      // console.log("processList", processList);
    })
    .catch((error) => {
      console.error("Error fetching process route:", error);
    });
};
