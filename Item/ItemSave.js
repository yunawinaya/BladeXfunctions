const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading();

    const data = this.getValues();
    console.log("Form data:", data);

    // Get page status from form data
    const page_status = data.page_status;
    const item_no = data.id;

    // Define required fields
    const requiredFields = [
      { name: "material_type", label: "Material Type" },
      { name: "material_name", label: "Material Name" },
      { name: "material_category", label: "Material Category" },
    ];

    // Validate form
    const missingFields = requiredFields.filter((field) => {
      const value = data[field.name];
      if (Array.isArray(value)) return value.length === 0;
      if (typeof value === "string") return value.trim() === "";
      return !value;
    });

    if (missingFields.length > 0) {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(
        `Please fill in all required fields: ${missingFieldNames}`
      );
      return;
    }

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Prepare entry data
    const entry = {
      is_active: data.is_active,
      imgupload_wk19nrhg: data.imgupload_wk19nrhg,
      material_type: data.material_type,
      organization_id: organizationId,
      material_code: data.material_code,
      material_name: data.material_name,
      material_category: data.material_category,
      material_sub_category: data.material_sub_category,
      material_desc: data.material_desc,
      material_costing_method: data.material_costing_method,
      stock_control: data.stock_control,
      show_delivery: data.show_delivery,
      show_receiving: data.show_receiving,
      based_uom: data.based_uom,
      table_uom_conversion: data.table_uom_conversion,
      purchase_tariff_id: data.purchase_tariff_id,
      mat_purchase_currency_id: data.mat_purchase_currency_id,
      mat_purchase_tax_id: data.mat_purchase_tax_id,
      purchase_tax_percent: data.purchase_tax_percent,
      purchase_unit_price: data.purchase_unit_price,
      sales_tariff_id: data.sales_tariff_id,
      mat_sales_tax_id: data.mat_sales_tax_id,
      sales_tax_percent: data.sales_tax_percent,
      mat_sales_currency_id: data.mat_sales_currency_id,
      sales_unit_price: data.sales_unit_price,
      item_batch_management: data.item_batch_management,
      batch_number_genaration: data.batch_number_genaration,
      brand_id: data.brand_id,
      brand_artwork_id: data.brand_artwork_id,
      subform_packaging_remark: data.subform_packaging_remark,
      reorder_level: data.reorder_level,
      shelf: data.shelf,
      lead_time: data.lead_time,
      assembly_cost: data.assembly_cost,
      bom_related: data.bom_related,
      reorder_quantity: data.reorder_quantity,
      irbm_id: data.irbm_id,
      production_time: data.production_time,
      additional_remark: data.additional_remark,
      over_receive_tolerance: data.over_receive_tolerance,
      under_receive_tolerance: data.under_receive_tolerance,
      over_delivery_tolerance: data.over_delivery_tolerance,
      under_delivery_tolerance: data.under_delivery_tolerance,
      posted_status: "Pending Post",
      barcode_number: data.barcode_number,
      purchase_default_uom: data.purchase_default_uom,
      sales_default_uom: data.sales_default_uom,
    };

    // Clean up undefined/null values
    Object.keys(entry).forEach((key) => {
      if (entry[key] === undefined || entry[key] === null) {
        delete entry[key];
      }
    });

    // Add or update based on page status
    if (page_status === "Add" || page_status === "Clone") {
      try {
        // First add the entry
        await db.collection("Item").add(entry);

        // Then update the prefix
        const prefixEntry = await db
          .collection("prefix_configuration")
          .where({
            document_types: "Items",
            is_deleted: 0,
            organization_id: organizationId,
            is_active: 1,
          })
          .get();

        if (prefixEntry.data && prefixEntry.data.length > 0) {
          const prefixData = prefixEntry.data[0];
          await db
            .collection("prefix_configuration")
            .where({
              document_types: "Items",
              is_deleted: 0,
              organization_id: organizationId,
            })
            .update({
              running_number: parseInt(prefixData.running_number) + 1,
              has_record: 1,
            });
        }

        // Run workflow
        await this.runWorkflow(
          "1906666085143818241",
          { key: "value" },
          (res) => {
            console.log("成功结果：", res);
            this.$message.success("Save item successfully.");
            closeDialog();
          },
          (err) => {
            console.error("失败结果：", err);
            this.$message.error(err);
            this.hideLoading();
          }
        );
      } catch (error) {
        console.error("Error adding item:", error);
        this.hideLoading();
        this.$message.error(
          error.message || "An error occurred while adding the item."
        );
      }
    } else if (page_status === "Edit") {
      try {
        // Update the existing item
        if (!item_no) {
          throw new Error("Item ID not found");
        }

        await db.collection("Item").doc(item_no).update(entry);

        // Run workflow
        await this.runWorkflow(
          "1906666085143818241",
          { key: "value" },
          (res) => {
            console.log("成功结果：", res);
            this.$message.success("Save item successfully.");
            closeDialog();
          },
          (err) => {
            console.error("失败结果：", err);
            this.$message.error(err);
            this.hideLoading();
          }
        );

        // Close dialog after successful operation
        closeDialog();
      } catch (error) {
        console.error("Error updating item:", error);
        this.hideLoading();
        this.$message.error(
          error.message || "An error occurred while updating the item."
        );
      }
    } else {
      this.hideLoading();
      this.$message.error("Invalid page status");
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.hideLoading();
    this.$message.error(
      error.message || "An error occurred while processing the item."
    );
  }
})();
