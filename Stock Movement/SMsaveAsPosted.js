const data = this.getValues();
const page_status = data.page_status;
const stockMovementId = data.id;

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

this.showLoading();

let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

const {
  issue_date,
  stock_movement_no,
  movement_type,
  movement_type_id,
  movement_reason,
  issued_by,
  issuing_operation_faci,
  remarks,
  delivery_method,
  reference_documents,
  receiving_operation_faci,
  movement_id,
  is_production_order,
  production_order_id,
  driver_name,
  driver_contact_no,
  vehicle_no,
  pickup_date,
  courier_company,
  shipping_date,
  freight_charges,
  tracking_number,
  est_arrival_date,
  delivery_cost,
  est_delivery_date,
  shipping_company,
  date_qn0dl3t6,
  input_77h4nsq8,
  shipping_method,
  tracking_no,
  stock_movement,
  balance_index,
  sm_item_balance,
  table_item_balance,
  material_id,
  material_name,
  row_index,
} = data;

const entry = {
  stock_movement_status: "Completed",
  organization_id: organizationId,
  posted_status: "Pending Post",
  issue_date,
  stock_movement_no,
  movement_type,
  movement_type_id,
  movement_reason,
  issued_by,
  issuing_operation_faci,
  remarks,
  delivery_method,
  reference_documents,
  receiving_operation_faci,
  movement_id,
  is_production_order,
  production_order_id,
  driver_name,
  driver_contact_no,
  vehicle_no,
  pickup_date,
  courier_company,
  shipping_date,
  freight_charges,
  tracking_number,
  est_arrival_date,
  delivery_cost,
  est_delivery_date,
  shipping_company,
  date_qn0dl3t6,
  input_77h4nsq8,
  shipping_method,
  tracking_no,
  stock_movement,
  balance_index,
  sm_item_balance,
  table_item_balance,
  material_id,
  material_name,
  row_index,
};

db.collection("stock_movement")
  .doc(stockMovementId)
  .update(entry)
  .then(async () => {
    await this.runWorkflow(
      "1910197713380311041",
      { key: "value" },
      (res) => {
        console.log("成功结果：", res);
        this.$message.success("Stock Movement posted successfully.");
      },
      (err) => {
        console.error("失败结果：", err);
        this.$message.error(err);
      }
    );
  })
  .then(() => {
    closeDialog();
  })
  .catch((error) => {
    closeDialog();
    this.$message.error(error);
  });
