// Chunked id reads with an explicit limit (the API clamps a read at IDA_READ_MAX rows, as GDonMounted.js); a short answer is read
// again for the ids it left out; a failed read rejects
const IDA_READ_CHUNK = 500;
const IDA_READ_MAX = 5000;
const idaChunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const idaUniq = (list) => [...new Set((list || []).filter((v) => v !== undefined && v !== null && v !== "").map(String))];
// rows of `collection` whose id is in `ids` (is_deleted 0), `fields` projected
const idaReadIds = async (collection, ids, fields) => {
  const rows = [];
  await Promise.all(
    idaChunks(idaUniq(ids), Math.min(IDA_READ_CHUNK, IDA_READ_MAX)).map(async (chunk) => {
      let left = chunk;
      while (left.length) {
        let query = db.collection(collection).filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "id", operator: "in", value: left },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ]);
        if (fields) query = query.field(fields);
        const res = await query.limit(left.length).get();
        const got = (res && res.data) || [];
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
