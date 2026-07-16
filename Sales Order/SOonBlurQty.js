(async () => {
  const itemID = arguments[0].row.item_name;
  const rowIndex = arguments[0].rowIndex;
  const quantity = arguments[0].row.so_quantity;
  const customerID = this.getValue("customer_name") ?? null;
  const plantID = this.getValue("plant_name") ?? null;

  console.log("arguments[0]", arguments[0]);

  if (arguments[0].field === "so_quantity") {
    // Recompute packing quantity from the packing_conversion already stored on
    // the line by SOonChangeUOM (no Item fetch needed here): packing_qty =
    // so_quantity / packing_conversion.
    const packingConversion = this.getValue(
      `table_so.${rowIndex}.packing_conversion`,
    );
    if (packingConversion && Number(packingConversion) > 0) {
      const packingQty =
        Math.round((quantity / Number(packingConversion)) * 1000) / 1000;
      this.setData({ [`table_so.${rowIndex}.packing_qty`]: packingQty });
    }

    // Recompute net weight from the weight_conversion (per-unit weight in the
    // SO's UOM) already stored on the line by SOonChangeUOM: net_weight =
    // so_quantity * weight_conversion.
    const weightConversion = this.getValue(
      `table_so.${rowIndex}.weight_conversion`,
    );
    if (
      weightConversion !== undefined &&
      weightConversion !== null &&
      weightConversion !== ""
    ) {
      const netWeight =
        Math.round(quantity * Number(weightConversion) * 1000) / 1000;
      this.setData({ [`table_so.${rowIndex}.net_weight`]: netWeight });
    }
  }

  if (arguments[0].row.from_historical === 0) {
    await this.runWorkflow(
      "2067818102244966401",
      {
        document_type: "SO",
        supp_cust_id: customerID,
        plant_id: plantID,
        item_data: [
          {
            item_id: arguments[0].row.item_name,
            unit_price: arguments[0].row.so_item_price,
            line_index: arguments[0].rowIndex,
            uom_id: arguments[0].row.so_item_uom,
            tax_rate: arguments[0].row.so_tax_preference || null,
            tax_percent: arguments[0].row.so_tax_percentage || null,
            quantity: arguments[0].row.so_quantity,
            discount: arguments[0].row.so_discount,
            discount_uom: arguments[0].row.so_discount_uom,
          },
        ],
      },
      async (result) => {
        console.log("result", result);
        if (result.data.needOverwrite === "No") {
          const updates = {};

          for (const item of result.data.data) {
            updates[`table_so.${item.line_index}.max_price`] = item.max_price;
            updates[`table_so.${item.line_index}.min_price`] = item.min_price;
          }

          await this.setData(updates);
          return;
        }
        await this.$confirm(
          "Multipricing found for this item. Do you want to use it?",
          "Confirmation",
          {
            confirmButtonText: "Overwrite",
            cancelButtonText: "Keep",
            dangerouslyUseHTMLString: true,
            type: "info",
            distinguishCancelAndClose: true,

            beforeClose: async (action, instance, done) => {
              if (action === "confirm") {
                const updates = {};

                for (const item of result.data.data) {
                  updates[`table_so.${item.line_index}.so_item_price`] =
                    item.unit_price;
                  updates[`table_so.${item.line_index}.so_item_uom`] =
                    item.uom_id;
                  updates[`table_so.${item.line_index}.so_tax_preference`] =
                    item.tax_rate;
                  updates[`table_so.${item.line_index}.so_tax_percentage`] =
                    item.tax_percent;
                  updates[`table_so.${item.line_index}.from_historical`] =
                    item.from_historical;
                  updates[`table_so.${item.line_index}.max_price`] =
                    item.max_price;
                  updates[`table_so.${item.line_index}.min_price`] =
                    item.min_price;
                  updates[`table_so.${item.line_index}.so_quantity`] =
                    item.quantity;
                  updates[`table_so.${item.line_index}.so_discount`] =
                    item.discount;
                  updates[`table_so.${item.line_index}.so_discount_uom`] =
                    item.discount_uom;
                  updates[`table_so.${item.line_index}.trigger_calc`] = "Yes";
                }

                await this.setData(updates);
                let Row = arguments[0];
                Row.row = this.getValue(`table_so.${rowIndex}`);

                await this.triggerEvent("SOCalculation", Row);
                done();
              } else if (action === "cancel") {
                const updates = {};

                for (const item of result.data.data) {
                  updates[`table_so.${item.line_index}.max_price`] =
                    item.max_price;
                  updates[`table_so.${item.line_index}.min_price`] =
                    item.min_price;
                }

                await this.setData(updates);
                done();
              } else {
                done();
              }
            },
          },
        );
      },
      (error) => {
        console.log("error", error);
      },
    );
  }
})();
