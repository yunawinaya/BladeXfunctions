const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
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

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }

    return obj.toString();
  }
  return null;
};

(async () => {
  try {
    this.showLoading();

    const data = this.getValues();

    const page_status = data.page_status;
    const item_alias_no = data.id;

    // Define required fields
    const requiredFields = [
      { name: "buyer_org_id", label: "Buyer Organization" },
      { name: "buyer_item_id", label: "Buyer Item Code" },
      { name: "buyer_uom_id", label: "Buyer Item UOM" },
      { name: "seller_org_id", label: "Seller Organization" },
      { name: "seller_item_id", label: "Seller Item Code" },
      { name: "seller_uom_id", label: "Seller Item UOM" },
      { name: "conversion_rate", label: "Conversion Rate" },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const entry = data;

      // Buyer and seller organizations must be different
      if (entry.buyer_org_id === entry.seller_org_id) {
        this.hideLoading();
        this.$message.error(
          "Buyer Organization and Seller Organization cannot be the same.",
        );
        return;
      }

      // Per-seller alias uniqueness: at most ONE active row may map a given
      // (buyer item + buyer UOM) for the same buyer/seller org pair. The PO -> SO
      // workflow loads aliases filtered by seller_org_id and keys its lookup on
      // buyer_item_id|buyer_uom_id, so a second active row with the same key would
      // silently overwrite (last-wins) and pick the wrong seller item. Mapping the
      // same buyer item to a DIFFERENT seller org is allowed (seller_org_id
      // disambiguates), so the seller org is part of the key. Inactive rows are not
      // loaded by the workflow, so only guard when this row will be active.
      if (entry.is_active !== 0) {
        const dupRes = await db
          .collection("item_alias")
          .where({
            buyer_org_id: entry.buyer_org_id,
            seller_org_id: entry.seller_org_id,
            buyer_item_id: entry.buyer_item_id,
            buyer_uom_id: entry.buyer_uom_id,
            is_active: 1,
          })
          .get();
        const duplicate = (dupRes.data || []).find(
          (r) => String(r.id) !== String(item_alias_no),
        );
        if (duplicate) {
          this.hideLoading();
          this.$message.error(
            "An active alias already exists for this buyer item, UOM, and seller organization. Please edit the existing alias instead of creating a duplicate.",
          );
          return;
        }
      }

      console.log("entry", entry);

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        try {
          await db.collection("item_alias").add(entry);
          this.$message.success("Add successfully.");
          await closeDialog();
        } catch (error) {
          console.error("Error adding item alias:", error);
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while adding the item alias.",
          );
        }
      } else if (page_status === "Edit") {
        try {
          // Update the existing item alias
          if (!item_alias_no) {
            throw new Error("Item Alias ID not found");
          }

          await db.collection("item_alias").doc(item_alias_no).update(entry);
          this.$message.success("Update successfully.");
          // Close dialog after successful operation
          closeDialog();
        } catch (error) {
          console.error("Error updating item alias:", error);
          this.hideLoading();
          this.$message.error(
            error.message ||
              "An error occurred while updating the item alias.",
          );
        }
      } else {
        this.hideLoading();
        this.$message.error("Invalid page status");
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    // Try to get message from standard locations first
    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(error);
  }
})();
