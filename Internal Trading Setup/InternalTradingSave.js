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
    const internal_trading_no = data.id;

    // Define required fields
    const requiredFields = [
      { name: "buyer_org_id", label: "Buyer Organization" },
      { name: "buyer_supplier_id", label: "Buyer Supplier" },
      { name: "seller_org_id", label: "Seller Organization" },
      { name: "seller_customer_id", label: "Seller Customer" },
      { name: "pricing_source", label: "Pricing Source" },
      { name: "tax_source", label: "Tax Source" },
      { name: "payment_term_source", label: "Payment Term Source" },
    ];

    // Buyer Plant is required only when auto-creating the buyer GR — the
    // seller-GD-triggered GR needs a receiving plant in the buyer org.
    if (data.auto_create_gr === 1) {
      requiredFields.push({ name: "buyer_plant_id", label: "Buyer Plant" });
    }

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

      // One internal supplier maps to exactly ONE seller org. The PO -> SO
      // workflow resolves the seller from internal_trading_setup by
      // buyer_supplier_id with limit 1, so two active setups for the same
      // supplier would resolve a seller non-deterministically and break
      // item-alias coverage (items split across sellers would fail). Enforce
      // uniqueness on (buyer_org_id, buyer_supplier_id) among active setups.
      // Inactive setups are not loaded by the workflow, so only guard when this
      // row will be active.
      if (entry.is_active !== 0) {
        const dupRes = await db
          .collection("internal_trading_setup")
          .where({
            buyer_org_id: entry.buyer_org_id,
            buyer_supplier_id: entry.buyer_supplier_id,
            is_active: 1,
          })
          .get();
        const duplicate = (dupRes.data || []).find(
          (r) => String(r.id) !== String(internal_trading_no),
        );
        if (duplicate) {
          this.hideLoading();
          this.$message.error(
            "This supplier is already set up for internal trading with a seller organization. Each supplier can map to only one seller organization.",
          );
          return;
        }
      }

      // Buyer Supplier and Seller Customer must share the same currency —
      // the PO -> SO auto-create blocks on a currency mismatch anyway, so reject
      // a mismatched setup up front. Compare by currency CODE, treating the base
      // code "----" as equal to "MYR".
      const [supRes, custRes] = await Promise.all([
        db
          .collection("supplier_head")
          .where({ id: entry.buyer_supplier_id })
          .get(),
        db.collection("Customer").where({ id: entry.seller_customer_id }).get(),
      ]);
      const supCurrencyId = supRes.data?.[0]?.currency_id || "";
      const custCurrencyId = custRes.data?.[0]?.customer_currency_id || "";

      if (String(supCurrencyId) !== String(custCurrencyId)) {
        const normalizeCode = (code) => (code === "----" ? "MYR" : code || "");
        const getCode = async (id) => {
          if (!id) return "";
          const res = await db.collection("currency").where({ id }).get();
          return normalizeCode(res.data?.[0]?.currency_code);
        };
        const [supCode, custCode] = await Promise.all([
          getCode(supCurrencyId),
          getCode(custCurrencyId),
        ]);
        if (supCode !== custCode) {
          this.hideLoading();
          this.$message.error(
            "Buyer Supplier and Seller Customer must have the same currency.",
          );
          return;
        }
      }

      // Normalize auto-create switches: anything other than 1 becomes 0
      entry.auto_create_so = entry.auto_create_so === 1 ? 1 : 0;
      entry.auto_create_gr = entry.auto_create_gr === 1 ? 1 : 0;
      entry.auto_create_pi = entry.auto_create_pi === 1 ? 1 : 0;

      console.log("entry", entry);

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        try {
          await db.collection("internal_trading_setup").add(entry);
          this.$message.success("Add successfully.");
          await closeDialog();
        } catch (error) {
          console.error("Error adding internal trading setup:", error);
          this.hideLoading();
          this.$message.error(
            error.message ||
              "An error occurred while adding the internal trading setup.",
          );
        }
      } else if (page_status === "Edit") {
        try {
          // Update the existing internal trading setup
          if (!internal_trading_no) {
            throw new Error("Internal Trading Setup ID not found");
          }

          await db
            .collection("internal_trading_setup")
            .doc(internal_trading_no)
            .update(entry);
          this.$message.success("Update successfully.");
          // Close dialog after successful operation
          closeDialog();
        } catch (error) {
          console.error("Error updating internal trading setup:", error);
          this.hideLoading();
          this.$message.error(
            error.message ||
              "An error occurred while updating the internal trading setup.",
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
