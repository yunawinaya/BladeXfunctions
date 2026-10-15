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

// true: GET_ITEM_UNIT_PRICE_BULK (same contract); false: GET_ITEM_UNIT_PRICE.
const USE_UNIT_PRICE_BULK = true;
const UNIT_PRICE_WORKFLOW_ID = USE_UNIT_PRICE_BULK
  ? "2110564019682578434"
  : "2067818102244966401";

const copyRow = (row) =>
  Array.isArray(row.children)
    ? { ...row, children: row.children.map(copyRow) }
    : { ...row };

// Prices merge into a costed copy of the table, written once, lines by key.
const fetchLatestPricing = async (
  result,
  overwrite,
  itemById,
  itemIdByLine,
  supplierId,
  keyByLine,
) => {
  const updates = {};
  for (const item of result) {
    const key = keyByLine[item.line_index];
    if (key === undefined) continue;
    const update = updates[key] || (updates[key] = {});

    if (overwrite === "Yes") {
      update.unit_price = item.unit_price;
      update.quantity_uom = item.uom_id;
      update.tax_preference = item.tax_rate;
      update.tax_percent = item.tax_percent;
      update.from_historical = item.from_historical;
      update.quantity = item.quantity;
      update.discount = item.discount;
      update.discount_uom = item.discount_uom;

      // Re-resolve the line description against the new supplier's binding.
      const masterId = itemIdByLine[item.line_index];
      const master = masterId ? itemById[String(masterId)] : null;
      if (master) {
        update.item_desc = resolveItemDesc(master, supplierId);
      }
    }

    update.max_price = item.max_price;
    update.min_price = item.min_price;
    update.moq_qty = item.moq;
  }

  const rows = (this.getValue("table_po") || []).map((row) =>
    updates[row.fm_key]
      ? Object.assign(copyRow(row), updates[row.fm_key])
      : copyRow(row),
  );
  const header = this.triggerEvent("POcalculation", { calcRows: rows });

  await this.setData({ table_po: rows, ...header });
};

(async () => {
  console.log(arguments[0]);

  // Captured once -- `arguments` resolves lexically through the nested arrow
  // callbacks below, which reads as a trap even though it works.
  const newSupplierId = arguments[0].value;

  this.disabled("table_po", !newSupplierId);

  const tablePO = this.getValue("table_po");

  if (tablePO.length > 0 && newSupplierId) {
    const hasItemID = tablePO.some((item) => item.item_id);
    const plantID = this.getValue("po_plant");
    if (hasItemID) {
      // Line -> item master, needed to re-resolve item_desc for the new
      // supplier. Started here (not awaited) so the single batched fetch
      // overlaps the pricing workflow round-trip.
      const itemIdByLine = {};
      const keyByLine = {};
      tablePO.forEach((line, index) => {
        if (line.item_id) itemIdByLine[index] = line.item_id;
        keyByLine[index] = line.fm_key;
      });
      const itemIds = [...new Set(Object.values(itemIdByLine))];
      const idChunks = [];
      for (let i = 0; i < itemIds.length; i += 500) {
        idChunks.push(itemIds.slice(i, i + 500));
      }
      const itemsPromise = Promise.all(
        idChunks.map((ids) =>
          db
            .collection("Item")
            .field("material_desc,table_sup_item_bind")
            .filter(new Filter().in("id", ids).build())
            .get()
            .catch(() => ({ data: [] })),
        ),
      ).then((results) => ({
        data: results.flatMap((res) => (res && res.data) || []),
      }));

      await this.runWorkflow(
        UNIT_PRICE_WORKFLOW_ID,
        {
          document_type: "PO",
          supp_cust_id: newSupplierId,
          plant_id: plantID,
          // Map first to keep the real row position, then skip the rows with
          // no item -- a bundle parent has an empty item_id.
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
            })
            .filter((row) => row.item_id),
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
              keyByLine,
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
                    keyByLine,
                  );

                  done();
                } else if (action === "cancel") {
                  await fetchLatestPricing(
                    result.data.data,
                    "No",
                    itemById,
                    itemIdByLine,
                    newSupplierId,
                    keyByLine,
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
  const currencyCode = currencyEntry?.currency_code || null;

  if (!currencyCode) {
    this.hide([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "button_refresh_rate",
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
        "button_refresh_rate",
        "myr_total_amount",
        "total_amount_myr",
      ]);
    } else {
      this.setData({ exchange_rate: 1 });
      this.hide([
        "exchange_rate",
        "exchange_rate_myr",
        "exchange_rate_currency",
        "button_refresh_rate",
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
