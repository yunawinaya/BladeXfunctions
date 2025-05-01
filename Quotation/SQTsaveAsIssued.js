const page_status = this.getParamsVariables("page_status");
const self = this;
const quotation_no = this.getParamsVariables("quotation_no");

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

this.getData()
  .then((data) => {
    const {
      sqt_customer_id,
      currency_code,
      sqt_billing_name,
      organization_id,
      sqt_billing_address,
      sqt_billing_cp,
      sqt_shipping_address,
      sqt_no,
      sqt_plant,
      sqt_date,
      sqt_validity_period,
      sales_person_id,
      sqt_payment_term,
      sqt_delivery_method_id,
      cp_customer_pickup,
      driver_contact_no,
      courier_company,
      vehicle_number,
      pickup_date,
      shipping_date,
      ct_driver_name,
      ct_vehicle_number,
      ct_driver_contact_no,
      ct_est_delivery_date,
      ct_delivery_cost,
      ct_shipping_company,
      ss_shipping_method,
      ss_shipping_date,
      est_arrival_date,
      ss_freight_charges,
      ss_tracking_number,
      sqt_sub_total,
      sqt_total_discount,
      sqt_total_tax,
      sqt_totalsum,
      sqt_remarks,
      table_sqt,
      sqt_ref_no,
      exchange_rate,
      myr_total_amount,
    } = data;

    const entry = {
      sqt_status: "Issued",
      sqt_customer_id,
      currency_code,
      sqt_billing_name,
      sqt_billing_address,
      sqt_billing_cp,
      organization_id: organizationId,
      sqt_shipping_address,
      sqt_no,
      sqt_plant,
      sqt_date,
      sqt_validity_period,
      sales_person_id,
      sqt_payment_term,
      sqt_delivery_method_id,
      cp_customer_pickup,
      driver_contact_no,
      courier_company,
      vehicle_number,
      pickup_date,
      shipping_date,
      ct_driver_name,
      ct_vehicle_number,
      ct_driver_contact_no,
      ct_est_delivery_date,
      ct_delivery_cost,
      ct_shipping_company,
      ss_shipping_method,
      ss_shipping_date,
      est_arrival_date,
      ss_freight_charges,
      ss_tracking_number,
      sqt_sub_total,
      sqt_total_discount,
      sqt_total_tax,
      sqt_totalsum,
      sqt_remarks,
      table_sqt,
      sqt_ref_no,
      exchange_rate,
      myr_total_amount,
    };

    if (page_status === "Add" || page_status === "Clone") {
      this.showLoading();
      db.collection("Quotation")
        .add(entry)
        .then(() => {
          return db
            .collection("prefix_configuration")
            .where({
              document_types: "Quotations",
              is_deleted: 0,
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
                    document_types: "Quotations",
                    is_deleted: 0,
                    organization_id: organizationId,
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
      this.showLoading();
      const quotationId = this.getParamsVariables("sqt_no");

      const prefixEntry = db
        .collection("prefix_configuration")
        .where({
          document_types: "Quotation",
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
        })
        .get()
        .then((prefixEntry) => {
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
                .collection("Quotation")
                .where({ sqt_no: generatedPrefix })
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
                  "Could not generate a unique Quotation number after maximum attempts"
                );
              } else {
                entry.sqt_no = prefixToShow;
                db.collection("Quotation").doc(quotationId).update(entry);
                db.collection("prefix_configuration")
                  .where({
                    document_types: "Quotations",
                    is_deleted: 0,
                    organization_id: organizationId,
                  })
                  .update({
                    running_number: parseInt(runningNumber) + 1,
                    has_record: 1,
                  });
              }
            };

            findUniquePrefix();
          } else {
            db.collection("Quotation").doc(quotationId).update(entry);
          }
        })
        .then(() => {
          closeDialog();
        })
        .catch((error) => {
          this.$message.error(error);
        });
    }
  })
  .catch((error) => {
    this.$message.error(error);
  });
