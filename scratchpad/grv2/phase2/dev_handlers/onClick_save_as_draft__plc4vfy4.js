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
              `${subField.label} (in ${field.label} #${index + 1})`,
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

const fillbackHeaderFields = async (entry) => {
  try {
    // table_gr is a tree: an item bundle is one row with its items under `children`.
    // This writes straight to the collection, so anything it skips is persisted
    // unstamped -- a bundle's items were being saved with no organization_id,
    // plant_id, supplier_id or line_index at all. Everything below is stamped on a
    // line wherever it sits in the tree; only the numbering differs, with a bundle's
    // items numbered within their own bundle.
    const stampGrLineItem = (grLineItem) => {
      grLineItem.supplier_id = entry.supplier_name || null;
      grLineItem.organization_id = entry.organization_id;
      grLineItem.plant_id = entry.plant_id || null;
      grLineItem.billing_state_id = entry.billing_address_state || null;
      grLineItem.billing_country_id = entry.billing_address_country || null;
      grLineItem.shipping_state_id = entry.shipping_address_state || null;
      grLineItem.shipping_country_id = entry.shipping_address_country || null;
      grLineItem.assigned_to = entry.assigned_to || null;
    };

    for (const [index, grLineItem] of entry.table_gr.entries()) {
      stampGrLineItem(grLineItem);
      grLineItem.line_index = index + 1;

      const children = Array.isArray(grLineItem.children) ? grLineItem.children : [];

      for (const [childIndex, child] of children.entries()) {
        stampGrLineItem(child);
        child.line_index = childIndex + 1;
      }
    }
    return entry.table_gr;
  } catch (error) {
    throw new Error("Error processing goods receiving.");
  }
};

(async () => {
  try {
    this.showLoading("Saving Goods Receiving...");
    const data = this.getValues();
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "gr_no", label: "Goods Receiving No" },
      {
        name: "table_gr",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    let entry = data;
    entry.gr_status = "Draft";

    if (data.page_status === "Add") {
      if (
        entry.gr_no_type !== -9999 &&
        (!entry.gr_no || entry.gr_no === null || entry.gr_no === "")
      ) {
        entry.gr_no = "draft";
      }
    }

    const missingFields = await validateForm(entry, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");
      const goodsReceivingId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      await fillbackHeaderFields(entry);

      if (page_status === "Add") {
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
    console.error(error);
    this.hideLoading();
    this.$message.error(error);
  }
})();
