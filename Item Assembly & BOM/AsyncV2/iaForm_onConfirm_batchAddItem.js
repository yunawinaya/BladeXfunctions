// Confirm of the shared Batch Add picker (page 1983386084789420033). The handler
// name is the callback convention that page uses -- MSI, MSR, SA, LOT, PT and CAT
// all expose it under exactly this name.
//
// Rows arrive with no quantity: requested_qty stays 0 because they carry no BOM
// demand, and the user types a quantity next, which allocates the line.
// A non-stock (labour / overhead) row keeps the typed quantity, no Transfer Stock.

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

(async () => {
  try {
    const currentItemArray = arguments[0].itemArray || [];

    if (currentItemArray.length === 0) {
      this.$alert("Please select at least one item.", "Error", {
        confirmButtonText: "OK",
        type: "error",
      });
      return;
    }

    const allData = this.getValues();
    const existingLines = allData.stock_movement || [];

    // Every selected item's UOMs resolved in one query rather than one per item.
    const uomIds = [
      ...new Set(
        currentItemArray
          .flatMap((item) => [
            item.based_uom,
            ...(item.table_uom_conversion || []).map((conv) => conv.alt_uom_id),
          ])
          .filter(Boolean)
      ),
    ];

    // only the picked rows without stock_control are read
    const unknownIds = currentItemArray
      .filter((item) => item.stock_control === undefined || item.stock_control === null)
      .map((item) => item.id);
    const [uomRes, stockRes] = await Promise.all([
      uomIds.length ? iaReadIds("unit_of_measurement", uomIds) : Promise.resolve({ data: [] }),
      unknownIds.length ? iaReadIds("Item", unknownIds, "stock_control") : Promise.resolve({ data: [] }),
    ]);

    const uomMap = new Map((uomRes.data || []).map((uom) => [uom.id, uom]));
    iaNsRemember(
      [...currentItemArray, ...(stockRes.data || [])]
        .filter((item) => iaIsNonStock(item))
        .map((item) => item.id)
    );

    const newRows = currentItemArray.map((item, index) => {
      const rowUoms = [
        item.based_uom,
        ...(item.table_uom_conversion || []).map((conv) => conv.alt_uom_id),
      ]
        .filter(Boolean)
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .map((id) => uomMap.get(id))
        .filter(Boolean);

      return {
        item_selection: item.id,
        item_name: item.material_name || "",
        item_desc: item.material_desc || "",
        requested_qty: 0,
        total_quantity: 0,
        quantity_uom: item.based_uom || "",
        uom_options: JSON.stringify(rowUoms),
        item_remark: "",
        project_id: allData.project_id || "",
        organization_id: allData.organization_id,
        issuing_plant: allData.issuing_operation_faci || "",
        line_index: existingLines.length + index + 1,
        balance_id: "",
        temp_qty_data: "",
        temp_hu_data: "",
        stock_summary: "",
      };
    });

    await this.setData({
      stock_movement: [...existingLines, ...newRows],
    });

    newRows.forEach((row, index) => {
      let options = [];
      try {
        options = JSON.parse(row.uom_options);
      } catch (e) {}
      this.setOptionData(
        [`stock_movement.${existingLines.length + index}.quantity_uom`],
        options
      );
    });
    iaNsLinks(newRows.map((row, index) => [existingLines.length + index, row.item_selection]));

    this.closeDialog("dialog_item_selection");
  } catch (error) {
    console.error("Error adding the selected items:", error);
    this.$message.error(error.message || "Failed to add the selected items");
  }
})();
