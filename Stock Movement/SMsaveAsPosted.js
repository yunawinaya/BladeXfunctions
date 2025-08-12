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

  cp_driver_name,
  cp_ic_no,
  cp_driver_contact_no,
  cp_vehicle_number,
  cp_pickup_date,
  cp_validity_collection,
  cs_courier_company,
  cs_shipping_date,
  cs_tracking_number,
  cs_est_arrival_date,
  cs_freight_charges,
  ct_driver_name,
  ct_driver_contact_no,
  ct_ic_no,
  ct_vehicle_number,
  ct_est_delivery_date,
  ct_delivery_cost,
  ss_shipping_company,
  ss_shipping_date,
  ss_freight_charges,
  ss_shipping_method,
  ss_est_arrival_date,
  ss_tracking_number,
  tpt_vehicle_number,
  tpt_transport_name,
  tpt_ic_no,
  tpt_driver_contact_no,

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

  cp_driver_name,
  cp_ic_no,
  cp_driver_contact_no,
  cp_vehicle_number,
  cp_pickup_date,
  cp_validity_collection,
  cs_courier_company,
  cs_shipping_date,
  cs_tracking_number,
  cs_est_arrival_date,
  cs_freight_charges,
  ct_driver_name,
  ct_driver_contact_no,
  ct_ic_no,
  ct_vehicle_number,
  ct_est_delivery_date,
  ct_delivery_cost,
  ss_shipping_company,
  ss_shipping_date,
  ss_freight_charges,
  ss_shipping_method,
  ss_est_arrival_date,
  ss_tracking_number,
  tpt_vehicle_number,
  tpt_transport_name,
  tpt_ic_no,
  tpt_driver_contact_no,

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
    // post workflow
    const accIntegrationType = this.getValue("acc_integration_type");

    if (
      accIntegrationType === "SQL Accounting" &&
      organizationId &&
      organizationId !== ""
    ) {
      console.log("Calling SQL Accounting workflow");

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
    } else if (
      accIntegrationType === "AutoCount Accounting" &&
      organizationId &&
      organizationId !== ""
    ) {
      this.$message.success("Post Stock Movement successfully");
      await closeDialog();
      console.log("Calling AutoCount workflow");
    } else if (
      accIntegrationType === "No Accounting Integration" &&
      organizationId &&
      organizationId !== ""
    ) {
      this.$message.success("Post Stock Movement successfully");
      await closeDialog();
      console.log("Not calling workflow");
    } else {
      await closeDialog();
    }
  })
  .then(() => {
    closeDialog();
  })
  .catch((error) => {
    closeDialog();
    this.$message.error(error);
  });
