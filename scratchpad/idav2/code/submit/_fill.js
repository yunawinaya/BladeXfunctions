// IDA_V2_SUBMIT - the lifted code_fillback + code_item_ids over the request's record (pure); `more` runs further lifted bodies in the same context
const idaFill = function idaFill(guard, form, more) {
  const doc = idaRecord(guard, form);
  let r = null;
  __withContext({ "workflowparams:allData": doc, "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": guard.pageStatus, "system:tenantId": guard.tenantId },
    () => {
      const fill = __run("code_fillback");
      const ids = __run("code_item_ids");
      const allData = obj(fill && fill.allData) ? fill.allData : {};
      allData.stock_movement = list(allData.stock_movement).filter(obj);
      r = { allData: allData, storedStatus: s(fill && fill.storedStatus), itemIds: list(ids && ids.itemIds).map(s).filter((x) => x),
        batchNumbers: list(ids && ids.batchNumbers).map((x) => (x === undefined || x === null ? "" : String(x))) };
      if (more) r.more = more(r);
    });
  return r;
};
