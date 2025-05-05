const page_status = this.getParamsVariables("page_status");
const data = this.getValues();
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

this.getData()
  .then((data) => {
    this.showLoading();
    if (page_status === "Add") {
      console.log("test", data.batch_number_genaration);
      console.log("data", data);
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }
      db.collection("Item")
        .add({
          is_active: data.is_active,
          imgupload_wk19nrhg: data.imgupload_wk19nrhg,
          material_type: data.material_type,
          organization_id: data.organization_id,
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
          over_delivery_tolerance: data.over_deliver_tolerance,
          under_delivery_tolerance: data.under_deliver_tolerance,
          posted_status: 0,
        })
        .then(() => {
          return db
            .collection("prefix_configuration")
            .where({
              document_types: "Items",
              is_deleted: 0,
              organization_id: organizationId,
              is_active: 1,
            })
            .get()
            .then((prefixEntry) => {
              const data = prefixEntry.data[0];
              return db
                .collection("prefix_configuration")
                .where({
                  document_types: "Items",
                  is_deleted: 0,
                  organization_id: organizationId,
                })
                .update({
                  running_number: parseInt(data.running_number) + 1,
                  has_record: 1,
                });
            });
        });
    } else if (page_status === "Edit") {
      const itemId = this.getParamsVariables("item_no");
      db.collection("Item").doc(itemId).update({
        is_active: data.is_active,
        imgupload_wk19nrhg: data.imgupload_wk19nrhg,
        material_type: data.material_type,
        organization_id: data.organization_id,
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
        over_delivery_tolerance: data.over_deliver_tolerance,
        under_delivery_tolerance: data.under_deliver_tolerance,
        posted_status: 0,
      });
    }
  })
  .then(() => {
    this.runWorkflow(
      "1906666085143818241",
      { key: "value" },
      (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
      }
    );
  })
  .then(() => {
    closeDialog();
  })
  .catch((error) => {
    this.$message.error(error);
  });
