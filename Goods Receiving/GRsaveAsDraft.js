const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value, field)) {
        missingFields.push(field.label);
      }
      return;
    }

    // Handle array fields
    if (!Array.isArray(value)) {
      missingFields.push(`${field.label}`);
      return;
    }

    if (value.length === 0) {
      missingFields.push(`${field.label}`);
      return;
    }

    // Check each item in the array
    if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue, subField)) {
            missingFields.push(
              `${subField.label} (in ${field.label} #${index + 1})`
            );
          }
        });
      });
    }
  });

  return missingFields;
};

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Receiving",
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
    const newPrefix = `DRAFT-${prefixData.prefix_value}-` + currDraftNum;

    db.collection("prefix_configuration")
      .where({
        document_types: "Goods Receiving",
        organization_id: organizationId,
      })
      .update({ draft_number: currDraftNum });

    return newPrefix;
  } catch (error) {
    throw new Error(error);
  }
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, grLineItem] of entry.table_gr.entries()) {
      grLineItem.supplier_id = entry.supplier_name || null;
      grLineItem.organization_id = entry.organization_id;
      grLineItem.plant_id = entry.plant_id || null;
      grLineItem.billing_state_id = entry.billing_address_state || null;
      grLineItem.billing_country_id = entry.billing_address_country || null;
      grLineItem.shipping_state_id = entry.shipping_address_state || null;
      grLineItem.shipping_country_id = entry.shipping_address_country || null;
      grLineItem.assigned_to = entry.assigned_to || null;
      grLineItem.line_index = index + 1;
    }
    return entry.table_gr;
  } catch (error) {
    throw new Error("Error processing goods receiving.");
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      {
        name: "table_gr",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");
      const goodsReceivingId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        po_id,
        purchase_order_number,
        gr_billing_address,
        gr_shipping_address,
        supplier_name,
        supplier_contact_person,
        supplier_contact_number,
        supplier_email,
        currency_code,
        gr_no,
        gr_received_by,
        gr_date,
        table_gr,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        billing_address_city,
        shipping_address_city,
        billing_postal_code,
        shipping_postal_code,
        billing_address_state,
        shipping_address_state,
        billing_address_country,
        shipping_address_country,
        plant_id,
        organization_id,
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
        reference_doc,
        ref_no_1,
        ref_no_2,
      } = data;

      const entry = {
        po_id,
        gr_status: "Draft",
        purchase_order_number,
        gr_billing_address,
        gr_shipping_address,
        supplier_name,
        supplier_contact_person,
        supplier_contact_number,
        supplier_email,
        currency_code,
        gr_no,
        gr_received_by,
        gr_date,
        table_gr,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        billing_address_city,
        shipping_address_city,
        billing_postal_code,
        shipping_postal_code,
        billing_address_state,
        shipping_address_state,
        billing_address_country,
        shipping_address_country,
        plant_id,
        organization_id,
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
        reference_doc,
        ref_no_1,
        ref_no_2,
      };

      await fillbackHeaderFields(entry);

      if (page_status === "Add") {
        const newPrefix = await generateDraftPrefix(organizationId);
        entry.gr_no = newPrefix;
        await db.collection("goods_receiving").add(entry);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db
          .collection("goods_receiving")
          .doc(goodsReceivingId)
          .update(entry);
        this.$message.success("Update successfully");
        closeDialog();
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
