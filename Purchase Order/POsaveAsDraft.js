const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return !value;
  });
  return missingFields;
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Purchase Orders",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const generateDraftPrefix = async (organizationId) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    const currDraftNum = parseInt(prefixData.draft_number) + 1;
    const newPrefix = "DRAFT-PO-" + currDraftNum;

    db.collection("prefix_configuration")
      .where({
        document_types: "Purchase Orders",
        organization_id: organizationId,
      })
      .update({ draft_number: currDraftNum });

    return newPrefix;
  } catch (error) {
    this.$message.error(error);
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [{ name: "po_plant", label: "Plant" }];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;
      const purchaseOrderId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        po_supplier_id,
        po_date,
        organization_id,
        po_currency,
        po_delivery_address,
        purchase_order_no,
        po_plant,
        partially_received,
        fully_received,
        po_receiving_supplier,
        po_billing_name,
        po_billing_cp,
        po_billing_address,
        po_shipping_address,
        po_payment_terms,
        po_expected_date,
        po_shipping_preference,
        po_ref_doc,
        table_po,
        po_total_gross,
        po_total_discount,
        po_total_tax,
        po_total,
        po_remark,
        po_tnc,
        preq_no,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_postal_code,
        billing_address_state,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_postal_code,
        shipping_address_state,
        shipping_address_country,
        exchange_rate,
        myr_total_amount,
      } = data;

      const entry = {
        po_status: "Draft",
        purchase_order_no,
        po_supplier_id,
        po_date,
        organization_id,
        po_currency,
        po_delivery_address,
        partially_received,
        fully_received,
        po_plant,
        po_receiving_supplier,
        po_billing_name,
        po_billing_cp,
        po_billing_address,
        po_shipping_address,
        po_payment_terms,
        po_expected_date,
        po_shipping_preference,
        po_ref_doc,
        table_po,
        po_total_gross,
        po_total_discount,
        po_total_tax,
        po_total,
        po_remark,
        po_tnc,
        preq_no,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_postal_code,
        billing_address_state,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_postal_code,
        shipping_address_state,
        shipping_address_country,
        exchange_rate,
        myr_total_amount,
      };

      if (page_status === "Add" || page_status === "Clone") {
        const newPrefix = await generateDraftPrefix(organizationId);
        entry.purchase_order_no = newPrefix;
        await db.collection("purchase_order").add(entry);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db
          .collection("purchase_order")
          .doc(purchaseOrderId)
          .update(entry);
        this.$message.success("Update successfully");
        closeDialog();
      }
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
