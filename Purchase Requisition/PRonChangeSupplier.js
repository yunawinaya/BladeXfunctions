// Pick the description this supplier has bound to the item on the Item master.
// Reads table_sup_item_bind (supplier_id / item_description) -- NOT the customer
// twin. An item may carry several rows for the same supplier: take the first one
// that actually has a description. Falls back to the item's own material_desc.
const resolveItemDesc = (item, supplierId) => {
  const fallback = item?.material_desc || "";
  if (!supplierId || Array.isArray(supplierId)) return fallback;

  const binds = Array.isArray(item?.table_sup_item_bind)
    ? item.table_sup_item_bind
    : [];
  const wanted = String(supplierId).trim();

  for (const row of binds) {
    if (!row) continue;
    if (String(row.supplier_id ?? "").trim() !== wanted) continue;
    const desc = String(row.item_description ?? "").trim();
    if (desc) return desc;
  }

  return fallback;
};

const fetchLatestPricing = async (
  result,
  overwrite,
  itemById,
  itemIdByLine,
  supplierId,
) => {
  const updates = {};
  for (const item of result) {
    if (overwrite === "Yes") {
      updates[`table_pr.${item.line_index}.pr_line_unit_price`] =
        item.unit_price;
      updates[`table_pr.${item.line_index}.pr_line_uom_id`] = item.uom_id;
      updates[`table_pr.${item.line_index}.pr_line_tax_rate_id`] =
        item.tax_rate;
      updates[`table_pr.${item.line_index}.pr_line_taxes_percent`] =
        item.tax_percent;
      updates[`table_pr.${item.line_index}.from_historical`] =
        item.from_historical;
      updates[`table_pr.${item.line_index}.pr_line_qty`] = item.quantity;
      updates[`table_pr.${item.line_index}.pr_line_discount`] = item.discount;
      updates[`table_pr.${item.line_index}.pr_line_discount_uom`] =
        item.discount_uom;

      // Re-resolve the line description against the new supplier's binding.
      const masterId = itemIdByLine[item.line_index];
      const master = masterId ? itemById[String(masterId)] : null;
      if (master) {
        updates[`table_pr.${item.line_index}.pr_line_material_desc`] =
          resolveItemDesc(master, supplierId);
      }
    }

    updates[`table_pr.${item.line_index}.pr_max_price`] = item.max_price;
    updates[`table_pr.${item.line_index}.pr_min_price`] = item.min_price;
    updates[`table_pr.${item.line_index}.moq_qty`] = item.moq;
  }

  await this.setData(updates);
  await this.triggerEvent("PRCalculation");
};

(async () => {
  console.log("argument", arguments[0]);

  // Captured once -- `arguments` resolves lexically through the nested arrow
  // callbacks below, which reads as a trap even though it works.
  const newSupplierId = arguments[0].value;

  if (newSupplierId) {
    const tablePREQ = this.getValue("table_pr");

    if (tablePREQ.length > 0) {
      const hasItemID = tablePREQ.some((item) => item.pr_line_material_id);
      const plantID = this.getValue("plant_id");

      if (hasItemID) {
        // Line -> item master, needed to re-resolve pr_line_material_desc for
        // the new supplier. Started here (not awaited) so the single batched
        // fetch overlaps the pricing workflow round-trip.
        const itemIdByLine = {};
        tablePREQ.forEach((line, index) => {
          if (line.pr_line_material_id)
            itemIdByLine[index] = line.pr_line_material_id;
        });
        const itemIds = [...new Set(Object.values(itemIdByLine))];
        const itemsPromise = itemIds.length
          ? db
              .collection("Item")
              .filter(new Filter().in("id", itemIds).build())
              .get()
              .catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] });

        await this.runWorkflow(
          "2067818102244966401",
          {
            document_type: "PREQ",
            supp_cust_id: newSupplierId,
            plant_id: plantID,
            item_data: tablePREQ.map((item, index) => {
              return {
                item_id: item.pr_line_material_id,
                unit_price: item.pr_line_unit_price,
                line_index: index,
                uom_id: item.pr_line_uom_id,
                tax_rate: item.pr_line_tax_rate_id || null,
                tax_percent: item.pr_line_taxes_percent || null,
                quantity: item.pr_line_qty,
                discount: item.pr_line_discount,
                discount_uom: item.pr_line_discount_uom,
              };
            }),
          },
          async (result) => {
            console.log("result", result);

            const resItems = await itemsPromise;
            const itemById = {};
            for (const it of (resItems && resItems.data) || [])
              itemById[String(it.id)] = it;

            if (result.data.needOverwrite === "No")
              await fetchLatestPricing(
                result.data.data,
                "No",
                itemById,
                itemIdByLine,
                newSupplierId,
              );

            await this.$confirm(
              `The supplier has been changed. Please choose one: <br><br>
        <strong>Overwrite:</strong> Replace the price and description based on the latest supplier. <em>(If any)</em><br>
        <strong>Keep:</strong> Keep the existing item price and description.`,
              "Supplier Change Detected",
              {
                confirmButtonText: "Overwrite",
                cancelButtonText: "Keep",
                dangerouslyUseHTMLString: true,
                type: "info",
                distinguishCancelAndClose: true,

                beforeClose: async (action, instance, done) => {
                  if (action === "confirm") {
                    await fetchLatestPricing(
                      result.data.data,
                      "Yes",
                      itemById,
                      itemIdByLine,
                      newSupplierId,
                    );

                    done();
                  } else if (action === "cancel") {
                    await fetchLatestPricing(
                      result.data.data,
                      "No",
                      itemById,
                      itemIdByLine,
                      newSupplierId,
                    );

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
    const currencyCode = currencyEntry.currency_code || null;

    if (!currencyCode) {
      this.hide([
        "exchange_rate",
        "exchange_rate_myr",
        "exchange_rate_currency",
        "myr_total_amount",
        "total_amount_myr",
      ]);
      this.setData({
        total_gross_currency: "",
        total_discount_currency: "",
        total_tax_currency: "",
        total_amount_currency: "",
        exchange_rate_currency: "",
        exchange_rate: 1,
      });
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
        this.setData({
          exchange_rate:
            Math.round(
              (parseFloat(currencyEntry.currency_buying_rate) || 0) * 10000,
            ) / 10000,
        });

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
      pr_payment_term_id: paymentTermID,
      currency_code: currencyCode,
      price_tag_id: priceTagID,
    });

    this.disabled("table_pr", false);
  } else {
    this.setData({
      total_gross_currency: "",
      total_discount_currency: "",
      total_tax_currency: "",
      total_amount_currency: "",
      exchange_rate_currency: "",
      exchange_rate: 1,
      currency_code: "",
    });
    this.hide([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);
  }
})();
