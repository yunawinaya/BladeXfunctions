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

this.getData((data) => {
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
    stock_movement_status: "Issued",
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
});

if (page_status === "Add") {
  db.collection("stock_movement")
    .add(entry)
    .then(() => {
      db.collection("prefix_configuration")
        .where({
          document_types: "Stock Movement",
          is_deleted: 0,
          movement_type: movement_type,
          organization_id: organizationId,
          is_active: 1,
        })
        .get()
        .then((prefixEntry) => {
          if (prefixEntry.data.length === 0) return;
          else {
            const data = prefixEntry.data[0];
            return db
              .collection("prefix_configuration")
              .where({
                document_types: "Stock Movement",
                is_deleted: 0,
                organization_id: organizationId,
                movement_type: movement_type,
              })
              .update({
                running_number: parseInt(data.running_number) + 1,
                has_record: 1,
              });
          }
        });
    })
    .then(() => {
      closeDialog();
    })
    .catch((error) => {
      this.$message.error(error);
    });
} else if (page_status === "Edit") {
  const prefixEntry = db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Movement",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
      movement_type: movement_type,
    })
    .get()
    .then(async (prefixEntry) => {
      if (prefixEntry.data.length > 0) {
        const prefixData = prefixEntry.data[0];
        const now = new Date();
        let prefixToShow;
        let runningNumber = prefixData.running_number;
        let isUnique = false;
        let maxAttempts = 10;
        let attempts = 0;

        const generatePrefix = (runNumber) => {
          let generated = prefixData.current_prefix_config;
          generated = generated.replace("prefix", prefixData.prefix_value);
          generated = generated.replace("suffix", prefixData.suffix_value);
          generated = generated.replace(
            "month",
            String(now.getMonth() + 1).padStart(2, "0")
          );
          generated = generated.replace(
            "day",
            String(now.getDate()).padStart(2, "0")
          );
          generated = generated.replace("year", now.getFullYear());
          generated = generated.replace(
            "running_number",
            String(runNumber).padStart(prefixData.padding_zeroes, "0")
          );
          return generated;
        };

        const checkUniqueness = async (generatedPrefix) => {
          const existingDoc = await db
            .collection("stock_movement")
            .where({ stock_movement_no: generatedPrefix })
            .get();
          return existingDoc.data[0] ? false : true;
        };

        const findUniquePrefix = async () => {
          while (!isUnique && attempts < maxAttempts) {
            attempts++;
            prefixToShow = generatePrefix(runningNumber);
            isUnique = await checkUniqueness(prefixToShow);
            if (!isUnique) {
              runningNumber++;
            }
          }

          if (!isUnique) {
            throw new Error(
              "Could not generate a unique Stock Movement number after maximum attempts"
            );
          } else {
            entry.stock_movement_no = prefixToShow;
            db.collection("stock_movement").doc(stockMovementId).update(entry);
            db.collection("prefix_configuration")
              .where({
                document_types: "Stock Movement",
                is_deleted: 0,
                organization_id: organizationId,
                movement_type: movement_type,
              })
              .update({
                running_number: parseInt(runningNumber) + 1,
                has_record: 1,
              });
          }
        };

        await findUniquePrefix();
      } else {
        db.collection("stock_movement").doc(stockMovementId).update(entry);
      }
    })
    .then(() => {
      closeDialog();
    })
    .catch((error) => {
      this.$message.error(error);
    });
}
