  // IA output split (plan 10-27, phase 2): the parent at each split row's bin joins the duplicate-balance screen; the split's read (its
  // bins, the stored rows) runs when the payload has rows, or leaves the key out on a stored IA (an old tab: the stored rows are received)
  const osRows = iaOsPayloadRows(a);
  const osBins = osRows.map((r) => iaIdStr(r.os_location_id)).filter((x) => x);
  const osEdit = guard.pageStatus === "Edit" && digits(guard.iaId);
  const osRead = osRows.length > 0 || (!Object.prototype.hasOwnProperty.call(a, "output_split") && osEdit);
  return out(answer("GO", "", "", { ok: "YES", itemIdsSql: iaIdsSql(f.itemIds), pickPairsJson: iaTuples(pairs), costPairsJson: iaTuples(pairs.concat([[parent, "0"]])),
    balTuplesJson: iaTuples(bals.concat([[parent, iaIdStr(a.location_id)]]).concat(osBins.map((b) => [parent, b]))), batchTuplesJson: iaTuples(batchBals),
    plantId: iaIdStr(a.issuing_operation_faci) || "0", organizationId: org, osRead: osRead ? "YES" : "NO", osBinIds: iaIdsSql(osBins), osIaId: osEdit ? s(guard.iaId) : "0" }));
};
