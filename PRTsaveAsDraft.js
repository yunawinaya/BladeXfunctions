const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};

const data = this.getValues();

const {
  purchase_return_no,
  purchase_order_id,
  goods_receiving_id,
  gr_ids,
  organization_id,
  supplier_id,
  prt_billing_name,
  prt_billing_cp,
  prt_billing_address,
  prt_shipping_address,
  gr_date,
  plant,
  purchase_return_date,
  input_hvxpruem,
  return_delivery_method,
  purchase_return_ref,
  shipping_details,
  reason_for_return,
  driver_name,
  vehicle_no,
  driver_contact,
  pickup_date,
  courier_company,
  shipping_date,
  estimated_arrival,
  shipping_method,
  freight_charge,
  driver_name2,
  driver_contact_no2,
  estimated_arrival2,
  vehicle_no2,
  delivery_cost,
  table_prt,
  billing_address_line_1,
  billing_address_line_2,
  billing_address_line_3,
  billing_address_line_4,
  billing_address_city,
  billing_address_state,
  billing_address_country,
  billing_postal_code,
  shipping_address_line_1,
  shipping_address_line_2,
  shipping_address_line_3,
  shipping_address_line_4,
  shipping_address_city,
  shipping_address_state,
  shipping_address_country,
  shipping_postal_code,
} = data;

const prt = {
  purchase_return_status: "Draft",
  purchase_return_no,
  purchase_order_id,
  goods_receiving_id,
  gr_ids,
  organization_id,
  supplier_id,
  prt_billing_name,
  prt_billing_cp,
  prt_billing_address,
  prt_shipping_address,
  gr_date,
  plant,
  purchase_return_date,
  input_hvxpruem,
  return_delivery_method,
  purchase_return_ref,
  shipping_details,
  reason_for_return,
  driver_name,
  vehicle_no,
  driver_contact,
  pickup_date,
  courier_company,
  shipping_date,
  estimated_arrival,
  shipping_method,
  freight_charge,
  driver_name2,
  driver_contact_no2,
  estimated_arrival2,
  vehicle_no2,
  delivery_cost,
  table_prt,
  billing_address_line_1,
  billing_address_line_2,
  billing_address_line_3,
  billing_address_line_4,
  billing_address_city,
  billing_address_state,
  billing_address_country,
  billing_postal_code,
  shipping_address_line_1,
  shipping_address_line_2,
  shipping_address_line_3,
  shipping_address_line_4,
  shipping_address_city,
  shipping_address_state,
  shipping_address_country,
  shipping_postal_code,
};

if (page_status === "Add") {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  db.collection("prefix_configuration")
    .where({
      document_types: "Purchase Returns",
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
        const newPrefix = "DRAFT-PRT-" + currDraftNum;
        prt.purchase_return_no = newPrefix;

        return db
          .collection("prefix_configuration")
          .where({ document_types: "Purchase Returns" })
          .update({ draft_number: currDraftNum });
      }
    })
    .then(() => {
      return db.collection("purchase_return_head").add(prt);
    })
    .then(() => {
      closeDialog();
    })
    .catch((error) => {
      alert(error);
    });
} else if (page_status === "Edit") {
  const purchaseReturnId = this.getParamsVariables("purchase_return_no");
  db.collection("purchase_return_head")
    .doc(purchaseReturnId)
    .update(prt)

    .then(() => {
      closeDialog();
    })
    .catch((error) => {
      alert(error);
    });
}
