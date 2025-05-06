const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

this.showLoading();
let movementType = this.getValue("movement_type") || "";

const data = this.getValues();
const page_status = data.page_status;
const stockMovementId = data.id;
const requiredFields = [{ name: "issuing_operation_faci", label: "Plant" }];

const missingFields = requiredFields.filter((field) => {
  const value = data[field.name];

  if (Array.isArray(value)) {
    return value.length === 0;
  } else if (typeof value === "string") {
    return value.trim() === "";
  } else {
    return !value;
  }
});

if (missingFields.length === 0) {
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
    stock_movement_status: "Draft",
    organization_id: organizationId,
    posted_status: "Unposted",
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

  if (page_status === "Add") {
    db.collection("prefix_configuration")
      .where({
        document_types: "Stock Movement",
        movement_type: movementType,
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get()
      .then((prefixEntry) => {
        if (!prefixEntry.data || prefixEntry.data.length === 0) {
          return;
        } else {
          const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
          const newPrefix =
            "DRAFT-" + prefixEntry.data[0].prefix_value + "-" + currDraftNum;
          entry.stock_movement_no = newPrefix;

          return db
            .collection("prefix_configuration")
            .where({
              document_types: "Stock Movement",
              movement_type: movementType,
              organization_id: organizationId,
            })
            .update({ draft_number: currDraftNum });
        }
      })
      .then(() => {
        return db.collection("stock_movement").add(entry);
      })
      .then(() => {
        closeDialog();
      })
      .catch((error) => {
        this.$message.error(error);
      });
  } else if (page_status === "Edit") {
    db.collection("stock_movement")
      .doc(stockMovementId)
      .update(entry)
      .then(() => {
        closeDialog();
      })
      .catch((error) => {
        this.$message.error(error);
      });
  }
} else {
  this.hideLoading();
  const missingFieldNames = missingFields.map((f) => f.label).join(", ");
  this.$message.error(`Missing required fields: ${missingFieldNames}`);
}
