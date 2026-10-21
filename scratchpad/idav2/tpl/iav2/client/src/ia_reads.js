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
