const page_status = this.getParamsVariables("page_status");
const self = this;
const stockMovementId = this.getParamsVariables("stock_movement_no");
const allData = self.getValues();

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const data = this.getValues();

const {
  movement_type,
  movement_reason,
  issued_by,
  issue_date,
  tenant_id,
  issuing_operation_faci,
  stock_movement,
  sm_item_balance,
  table_item_balance,
  remarks,
  delivery_method,
  driver_name,
  vehicle_no,
  pickup_date,
  courier_company,
  tracking_number,
  freight_charges,
  driver_contact_no,
  delivery_cost,
  est_delivery_date,
  shipping_company,
  date_qn0dl3t6,
  input_77h4nsq8,
  shipping_method,
  est_arrival_date,
  tracking_no,
  balance_index,
} = data;

const entry = {
  po_status: "Draft",
  movement_type,
  movement_reason,
  issued_by,
  issue_date,
  tenant_id,
  issuing_operation_faci,
  stock_movement,
  sm_item_balance,
  table_item_balance,
  remarks,
  delivery_method,
  driver_name,
  vehicle_no,
  pickup_date,
  courier_company,
  tracking_number,
  freight_charges,
  driver_contact_no,
  delivery_cost,
  est_delivery_date,
  shipping_company,
  date_qn0dl3t6,
  input_77h4nsq8,
  shipping_method,
  est_arrival_date,
  tracking_no,
  balance_index,
};

if (page_status === "Add") {
  db.collection("prefix_configuration")
    .where({ document_types: "Stock Movement", is_deleted: 0 })
    .get()
    .then((prefixEntry) => {
      if (!prefixEntry.data || prefixEntry.data.length === 0) {
        throw new Error("No prefix configuration found");
      }

      const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
      const newPrefix = "ISSUE-" + allData.stock_movement_no;
      entry.stock_movement_no = newPrefix;
      db.collection("stock_movement").add({
        stock_movement_status: "Issued",
        stock_movement_no: entry.stock_movement_no,
        movement_type: allData.movement_type,
        movement_reason: allData.movement_reason || null,
        issued_by: allData.issued_by || allData.user_id || "system",
        issue_date: allData.issue_date,
        tenant_id: allData.tenant_id || "000000",
        issuing_operation_faci: allData.issuing_operation_faci,
        stock_movement: allData.stock_movement,
        sm_item_balance: allData.sm_item_balance,
        table_item_balance: table_item_balance,
        remarks: allData.remarks,
        delivery_method: allData.delivery_method,
        driver_name: allData.driver_name,
        vehicle_no: allData.vehicle_no,
        pickup_date: allData.pickup_date,
        courier_company: allData.courier_company,
        tracking_number: allData.tracking_number,
        est_arrival_date: allData.est_arrival_date,
        freight_charges: allData.freight_charges,
        driver_name: allData.driver_name,
        vehicle_no: allData.vehicle_no,
        driver_contact_no: allData.driver_contact_no,
        delivery_cost: allData.delivery_cost,
        est_delivery_date: allData.est_delivery_date,
        shipping_company: allData.shipping_company,
        shipping_method: allData.shipping_method,
        date_qn0dl3t6: allData.date_qn0dl3t6,
        input_77h4nsq8: allData.input_77h4nsq8,
        shipping_method: allData.shipping_method,
        est_arrival_date: allData.est_arrival_date,
        tracking_no: allData.tracking_no,
        balance_index: allData.balance_index,
      });
      closeDialog();
      return currDraftNum;
    });
} else if (page_status === "Edit") {
  this.getData()
    .then((data) => {
      db.collection("stock_movement")
        .doc(stockMovementId)
        .update({
          stock_movement_status: "Issued",
          stock_movement_no: allData.stock_movement_no,
          movement_type: allData.movement_type,
          movement_reason: allData.movement_reason || null,
          issued_by: allData.issued_by || allData.user_id || "system",
          issue_date: allData.issue_date,
          tenant_id: allData.tenant_id || "000000",
          issuing_operation_faci: allData.issuing_operation_faci,
          stock_movement: allData.stock_movement,
          sm_item_balance: allData.sm_item_balance,
          table_item_balance: table_item_balance,
          remarks: allData.remarks,
          delivery_method: allData.delivery_method,
          driver_name: allData.driver_name,
          vehicle_no: allData.vehicle_no,
          pickup_date: allData.pickup_date,
          courier_company: allData.courier_company,
          tracking_number: allData.tracking_number,
          est_arrival_date: allData.est_arrival_date,
          freight_charges: allData.freight_charges,
          driver_name: allData.driver_name,
          vehicle_no: allData.vehicle_no,
          driver_contact_no: allData.driver_contact_no,
          delivery_cost: allData.delivery_cost,
          est_delivery_date: allData.est_delivery_date,
          shipping_company: allData.shipping_company,
          shipping_method: allData.shipping_method,
          date_qn0dl3t6: allData.date_qn0dl3t6,
          input_77h4nsq8: allData.input_77h4nsq8,
          shipping_method: allData.shipping_method,
          est_arrival_date: allData.est_arrival_date,
          tracking_no: allData.tracking_no,
          balance_index: allData.balance_index,
        });
    })
    .then(() => {
      closeDialog();
    });
}
