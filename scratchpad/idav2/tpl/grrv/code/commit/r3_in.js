// GR_REVERT_COMMIT - R3 input: the DOCS part -> the ids of the documents to read fresh (digits only)
const commitR3In = function commitR3In(entry, docRows) {
  const d = joinChunks(docRows, entry.partPrefix + "DOCS|");
  if (!d) return { ok: "NO", why: "the documents part of the prepared payload is missing", toIdsSql: "0", itIdsSql: "0", qiIdsSql: "0", batchIdsSql: "0", docs: {} };
  const docs = { putaway: list(d.putaway).map(s).filter(digits), transit: list(d.transit).filter((t) => digits(t.id)).map((t) => s(t.id)), qi: list(d.qi).map(s).filter(digits),
    batches: list(d.batches).map(s).filter(digits) };
  return { ok: "YES", why: "", toIdsSql: idsSql(docs.putaway), itIdsSql: idsSql(docs.transit), qiIdsSql: idsSql(docs.qi), batchIdsSql: idsSql(docs.batches), docs: docs };
};
const res = commitR3In([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr3part.data}}][0]);
console.log("commit R3 input", JSON.stringify({ ok: res.ok, to: (res.docs.putaway || []).length, it: (res.docs.transit || []).length, qi: (res.docs.qi || []).length, batches: (res.docs.batches || []).length }));
return res;
