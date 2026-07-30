const fetchLatestPricing = async (result, overwrite) => {
  const updates = {};
  for (const item of result) {
    if (overwrite === "Yes") {
      updates[`table_po.${item.line_index}.unit_price`] = item.unit_price;
      updates[`table_po.${item.line_index}.quantity_uom`] = item.uom_id;
      updates[`table_po.${item.line_index}.tax_preference`] = item.tax_rate;
      updates[`table_po.${item.line_index}.tax_percent`] = item.tax_percent;
      updates[`table_po.${item.line_index}.from_historical`] =
        item.from_historical;
      updates[`table_po.${item.line_index}.quantity`] = item.quantity;
      updates[`table_po.${item.line_index}.discount`] = item.discount;
      updates[`table_po.${item.line_index}.discount_uom`] = item.discount_uom;
    }

    updates[`table_po.${item.line_index}.max_price`] = item.max_price;
    updates[`table_po.${item.line_index}.min_price`] = item.min_price;
    updates[`table_po.${item.line_index}.moq_qty`] = item.moq;
  }

  await this.setData(updates);
  await this.triggerEvent("POcalculation");
};

(async () => {
  console.log(arguments[0]);

  this.disabled("table_po", !arguments[0].value);

  const tablePO = this.getValue("table_po");

  if (tablePO.length > 0 && arguments[0].value) {
    const hasItemID = tablePO.some((item) => item.item_id);
    const plantID = this.getValue("po_plant");
    if (hasItemID) {
      await this.runWorkflow(
        "2067818102244966401",
        {
          document_type: "PO",
          supp_cust_id: arguments[0].value,
          plant_id: plantID,
          item_data: tablePO.map((item, index) => {
            return {
              item_id: item.item_id,
              unit_price: item.unit_price,
              line_index: index,
              uom_id: item.quantity_uom,
              tax_rate: item.tax_preference || null,
              tax_percent: item.tax_percent || null,
              quantity: item.quantity,
              discount: item.discount,
              discount_uom: item.discount_uom,
            };
          }),
        },
        async (result) => {
          console.log("result", result);

          if (result.data.needOverwrite === "No")
            await fetchLatestPricing(result.data.data, "No");

          await this.$confirm(
            `The supplier has been changed. Please choose one: <br><br>Please choose one: <br>
        <strong>Overwrite:</strong> Replace the price based on the latest supplier. <em>(If any)</em><br>
        <strong>Keep:</strong> Keep the existing item price.`,
            "Supplier Change Detected",
            {
              confirmButtonText: "Overwrite",
              cancelButtonText: "Keep",
              dangerouslyUseHTMLString: true,
              type: "info",
              distinguishCancelAndClose: true,

              beforeClose: async (action, instance, done) => {
                if (action === "confirm") {
                  await fetchLatestPricing(result.data.data, "Yes");

                  done();
                } else if (action === "cancel") {
                  await fetchLatestPricing(result.data.data, "No");

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
  }

  const currencyID = arguments[0].fieldModel.item.currency_id;
  const paymentTermID = arguments[0].fieldModel.item.supplier_payment_term_id;
  const priceTagID = arguments[0].fieldModel.item.price_tag_id;

  const resCurrency = await db
    .collection("currency")
    .where({ id: currencyID })
    .get();

  const currencyEntry = resCurrency.data[0];
  const currencyCode = currencyEntry?.currency_code || null;

  if (!currencyCode) {
    this.hide([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);
    return;
  } else {
    this.setData({
      total_gross_currency: currencyCode,
      total_discount_currency: currencyCode,
      total_tax_currency: currencyCode,
      total_amount_currency: currencyCode,
      exchange_rate_currency: currencyCode,
    });

    if (currencyCode !== "----" && currencyCode !== "MYR") {
      this.setData({ exchange_rate: currencyEntry.currency_buying_rate });

      this.display([
        "exchange_rate",
        "exchange_rate_myr",
        "exchange_rate_currency",
        "myr_total_amount",
        "total_amount_myr",
      ]);
    } else {
      this.setData({ exchange_rate: 1 });
      this.hide([
        "exchange_rate",
        "exchange_rate_myr",
        "exchange_rate_currency",
        "myr_total_amount",
        "total_amount_myr",
      ]);
    }
  }

  this.setData({
    po_payment_terms: paymentTermID,
    price_tag_id: priceTagID,
    po_currency: currencyCode,
  });
})();
