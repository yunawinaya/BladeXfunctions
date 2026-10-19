// Item Code on a manually added component row. Mirrors MSI's onAfterUpdate_item,
// with the UOM options resolved in one batched query rather than one per UOM.
//
// requested_qty is left at 0: the row carries no BOM demand, which is also what
// marks it as added when the BOM variance is reported at completion.
// A non-stock (labour / overhead) item gets no Transfer Stock: its quantity is typed.

// Chunked reads with an explicit limit (the API clamps at IA_READ_MAX rows, as GDonMounted.js); a clamped read is read again
const IA_READ_CHUNK = 500;
const IA_READ_MAX = 5000;
const iaChunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const iaUniq = (list) => [...new Set((list || []).filter((v) => v !== undefined && v !== null && v !== "").map(String))];

// rows of `collection` whose id is in `ids` (is_deleted 0), `fields` projected
const iaReadIds = async (collection, ids, fields) => {
  const rows = [];
  await Promise.all(
    iaChunks(iaUniq(ids), Math.min(IA_READ_CHUNK, IA_READ_MAX)).map(async (chunk) => {
      let left = chunk;
      while (left.length) {
        let got = [];
        try {
          let query = db.collection(collection);
          if (fields) query = query.field(fields);
          const res = await query
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  { prop: "id", operator: "in", value: left },
                  { prop: "is_deleted", operator: "equal", value: 0 },
                ],
              },
            ])
            .limit(left.length)
            .get();
          got = (res && res.data) || [];
        } catch (error) {
          console.error(`Error fetching ${collection}:`, error);
          return;
        }
        rows.push(...got);
        const seen = new Set(got.map((row) => String(row.id)));
        const missing = left.filter((id) => !seen.has(id));
        if (!got.length || missing.length === left.length) return;
        left = missing;
      }
    }),
  );
  return { data: rows };
};

// rows of `collection` whose `prop` is in `values`, with the other conditions
const iaReadMany = async (collection, prop, values, conditions) => {
  const rows = [];
  const read = async (chunk) => {
    let got = [];
    try {
      const res = await db
        .collection(collection)
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [{ prop: prop, operator: "in", value: chunk }, ...conditions],
          },
        ])
        .limit(IA_READ_MAX)
        .get();
      got = (res && res.data) || [];
    } catch (error) {
      console.error(`Error fetching ${collection}:`, error);
      return;
    }
    if (got.length >= IA_READ_MAX && chunk.length > 1) {
      const half = Math.ceil(chunk.length / 2);
      await Promise.all([read(chunk.slice(0, half)), read(chunk.slice(half))]);
      return;
    }
    if (got.length >= IA_READ_MAX) console.error(`${collection}: more than ${IA_READ_MAX} rows for ${chunk[0]}; ${got.length} read`);
    rows.push(...got);
  };
  await Promise.all(iaChunks(iaUniq(values), IA_READ_CHUNK).map(read));
  return { data: rows };
};

// Non-stock (stock_control 0) item ids learnt by one handler, kept for the others in this.models._data
const iaIsNonStock = (item) => !!item && (item.stock_control === 0 || item.stock_control === "0");
const iaNsItems = () => (this.models["_data"] || {}).ia_ns_items || {};
const iaNsRemember = (ids) => {
  if (!ids.length) return;
  const known = { ...iaNsItems() };
  ids.forEach((id) => {
    known[String(id)] = 1;
  });
  this.models["_data"] = { ...this.models["_data"], ia_ns_items: known };
};
// Transfer Stock off for the non-stock rows of [rowIndex, itemId] pairs, on again for the rest once any was switched off
const iaNsLinks = (pairs) => {
  const known = iaNsItems();
  const off = [];
  const on = [];
  pairs.forEach(([index, itemId]) => (known[String(itemId)] ? off : on).push(`stock_movement.${index}.transfer_stock`));
  if (!off.length && !(this.models["_data"] || {}).ia_ns_links) return;
  if (off.length) {
    this.models["_data"] = { ...this.models["_data"], ia_ns_links: 1 };
    this.disabled(off, true);
  }
  if (on.length) this.disabled(on, false);
};

const clearRow = (rowIndex, extra) =>
  this.setData(
    Object.assign(
      {
        [`stock_movement.${rowIndex}.requested_qty`]: 0,
        [`stock_movement.${rowIndex}.total_quantity`]: 0,
        [`stock_movement.${rowIndex}.balance_id`]: "",
        [`stock_movement.${rowIndex}.temp_qty_data`]: "",
        [`stock_movement.${rowIndex}.temp_hu_data`]: "",
        [`stock_movement.${rowIndex}.stock_summary`]: "",
      },
      extra
    )
  );

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const value = arguments[0].value;

    if (!value) {
      await clearRow(rowIndex, {
        [`stock_movement.${rowIndex}.item_name`]: "",
        [`stock_movement.${rowIndex}.item_desc`]: "",
        [`stock_movement.${rowIndex}.quantity_uom`]: "",
        [`stock_movement.${rowIndex}.uom_options`]: "",
      });
      return;
    }

    const itemData = arguments[0]?.fieldModel?.item;
    if (!itemData) {
      // The table re-renders without a fieldModel on a plain refresh; restore the
      // UOM options every row already carries so no select goes blank.
      const lines = this.getValue("stock_movement") || [];
      lines.forEach((line, idx) => {
        let options = [];
        try {
          options = JSON.parse(line.uom_options || "[]");
        } catch (e) {}
        this.setOptionData([`stock_movement.${idx}.quantity_uom`], options);
      });
      return;
    }

    const allData = this.getValues();

    const uomIds = [
      itemData.based_uom,
      ...(itemData.table_uom_conversion || []).map((conv) => conv.alt_uom_id),
    ]
      .filter(Boolean)
      .filter((id, i, arr) => arr.indexOf(id) === i);

    // the picked row carries stock_control; read only when it does not
    const known = itemData.stock_control !== undefined && itemData.stock_control !== null;
    const [uomRes, stockRes] = await Promise.all([
      uomIds.length ? iaReadIds("unit_of_measurement", uomIds) : Promise.resolve({ data: [] }),
      known ? Promise.resolve({ data: [itemData] }) : iaReadIds("Item", [value], "stock_control"),
    ]);

    const uomOptions = uomRes.data || [];

    await clearRow(rowIndex, {
      [`stock_movement.${rowIndex}.item_name`]: itemData.material_name || "",
      [`stock_movement.${rowIndex}.item_desc`]: itemData.material_desc || "",
      [`stock_movement.${rowIndex}.quantity_uom`]: itemData.based_uom || "",
      [`stock_movement.${rowIndex}.uom_options`]: JSON.stringify(uomOptions),
      // Seeded here the same way the explosion seeds its rows, so an added line
      // reaches the save workflow with the same columns filled.
      [`stock_movement.${rowIndex}.organization_id`]: allData.organization_id,
      [`stock_movement.${rowIndex}.issuing_plant`]:
        allData.issuing_operation_faci || "",
      [`stock_movement.${rowIndex}.project_id`]: allData.project_id || "",
    });

    this.setOptionData([`stock_movement.${rowIndex}.quantity_uom`], uomOptions);

    if (iaIsNonStock((stockRes.data || [])[0])) iaNsRemember([value]);
    iaNsLinks([[rowIndex, value]]);
  } catch (error) {
    console.error("Error loading the component item:", error);
    this.$message.error(error.message || "Failed to load the item");
  }
})();
