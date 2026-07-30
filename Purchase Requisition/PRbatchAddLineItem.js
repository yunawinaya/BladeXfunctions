(async () => {
  const currentItemArray = arguments[0].itemArray;
  const preqLineItems = this.getValue("table_pr");
  const itemArray = [];
  const supplierID = this.getValue("pr_supplier_name");
  const plantID = this.getValue("plant_id");

  if (currentItemArray.length === 0) {
    this.$alert("Please select at least one item.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });

    return;
  }

  for (const item of currentItemArray) {
    let defaultPurchaseDetail = item.table_uom_conversion.find(
      (uom) => uom.purchase_default_uom === 1,
    );

    if (!defaultPurchaseDetail) {
      defaultPurchaseDetail = item.table_uom_conversion.find(
        (uom) => uom.alt_uom_id === item.based_uom,
      );
    }

    const preqItem = {
      pr_line_material_id: item.id,
      pr_line_material_name: item.material_name,
      pr_line_material_desc: item.material_desc,
      pr_line_unit_price: defaultPurchaseDetail.purchase_unit_price || 0,
      item_category_id: item.item_category,
      pr_line_tax_rate_id: defaultPurchaseDetail.mat_purchase_tax_id || null,
      pr_line_taxes_percent: defaultPurchaseDetail.purchase_tax_percent || null,
      pr_line_uom_id: defaultPurchaseDetail.alt_uom_id || null,
      table_uom_conversion: item.table_uom_conversion,
      further_description: item.further_description,
    };

    itemArray.push(preqItem);
  }

  await this.setData({
    table_pr: [...preqLineItems, ...itemArray],
  });

  this.closeDialog("dialog_item_selection");

  setTimeout(async () => {
    console.log("preqLineItems", preqLineItems);
    for (const [index, item] of currentItemArray.entries()) {
      const newIndex = preqLineItems.length + index;
      console.log("item", item);
      this.disabled([`table_pr.${newIndex}.pr_line_uom_id`], false);
      this.refreshFieldOptionData([
        `table_pr.${newIndex}.pr_line_uom_id`,
        `table_pr.${newIndex}.pr_line_taxes_percent`,
      ]);

      if (item.mat_purchase_tax_id) {
        this.disabled([`table_pr.${newIndex}.pr_line_taxes_percent`], false);
      }
    }

    await this.runWorkflow(
      "2067818102244966401",
      {
        document_type: "PREQ",
        supp_cust_id: supplierID,
        plant_id: plantID,
        item_data: itemArray.map((item, index) => {
          return {
            item_id: item.pr_line_material_id,
            unit_price: item.pr_line_unit_price,
            line_index: preqLineItems.length + index,
            uom_id: item.pr_line_uom_id,
            tax_rate: item.pr_line_tax_rate_id || null,
            tax_percent: item.pr_line_taxes_percent || null,
          };
        }),
      },
      async (result) => {
        console.log("result", result);
        const updates = {};

        for (const item of result.data.data) {
          updates[`table_pr.${item.line_index}.pr_line_unit_price`] =
            item.unit_price;
          updates[`table_pr.${item.line_index}.pr_line_uom_id`] = item.uom_id;
          updates[`table_pr.${item.line_index}.pr_line_tax_rate_id`] =
            item.tax_rate;
          updates[`table_pr.${item.line_index}.pr_line_taxes_percent`] =
            item.tax_percent;
          updates[`table_pr.${item.line_index}.from_historical`] =
            item.from_historical;
          updates[`table_pr.${item.line_index}.pr_max_price`] = item.max_price;
          updates[`table_pr.${item.line_index}.pr_min_price`] = item.min_price;
          updates[`table_pr.${item.line_index}.pr_line_qty`] = item.quantity;
          updates[`table_pr.${item.line_index}.moq_qty`] = item.moq;
          updates[`table_pr.${item.line_index}.pr_line_discount`] =
            item.discount;
          updates[`table_pr.${item.line_index}.pr_line_discount_uom`] =
            item.discount_uom;
        }

        await this.setData(updates);
        await this.triggerEvent("PRCalculation");
      },
      (error) => {
        console.log("error", error);
      },
    );
  }, 50);
})();
