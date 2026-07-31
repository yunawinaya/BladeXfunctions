(async () => {
  const clearImport = () => {
    this.setData({ import_cust_bind: "" });
  };

  // Escape dynamic text before injecting into dangerouslyUseHTMLString dialogs
  // (same helper as POsaveAsIssued.js).
  const escapeHtml = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
  const lc = (v) => str(v).toLowerCase();

  // Header lookup: "Customer Item Alias" / "customer_item_alias" / "CustItemAlias"
  // all collapse to the same key, so a hand-edited template still resolves.
  const normKey = (k) =>
    String(k || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const HEADERS = {
    code: ["customercode", "custcode", "customerid"],
    name: ["customername", "custname", "companyname", "customercomname"],
    alias: ["customeritemalias", "custitemalias", "itemalias", "alias"],
    desc: ["itemdescription", "itemdesc", "description", "desc"],
  };
  const pick = (normRow, names) => {
    for (const n of names) {
      if (normRow[n] !== undefined) {
        const v = str(normRow[n]);
        if (v) return v;
      }
    }
    return "";
  };

  // Cap the error list so the dialog stays readable.
  const MAX_LISTED = 15;
  const formatList = (list) => {
    const shown = list.slice(0, MAX_LISTED).map((m) => "• " + escapeHtml(m));
    if (list.length > MAX_LISTED) {
      shown.push("… and " + (list.length - MAX_LISTED) + " more.");
    }
    return shown.join("<br>");
  };

  try {
    const excelData = arguments[0].value;

    // --- 1. normalize the parsed payload into an ordered list of rows ---------
    // The parser emits an object keyed "0","1","2"... alongside name/size/type
    // meta keys; a plain array is accepted too.
    // `seq` is the spreadsheet line number: the parser consumes line 1 as the
    // header row, so data index 0 is line 2.
    let rawRows = [];
    if (Array.isArray(excelData)) {
      rawRows = excelData.map((data, i) => ({ seq: i + 2, data: data || {} }));
    } else if (excelData && typeof excelData === "object") {
      rawRows = Object.keys(excelData)
        .filter((k) => /^\d+$/.test(k))
        .map((k) => parseInt(k, 10))
        .sort((a, b) => a - b)
        .map((k) => ({ seq: k + 2, data: excelData[k] || {} }));
    }

    if (rawRows.length === 0) {
      this.$message.error("No data found in the imported file.");
      clearImport();
      return;
    }

    // --- 2. read the cells, drop fully blank rows -----------------------------
    const rows = [];
    const errors = [];
    for (const r of rawRows) {
      const normRow = {};
      Object.keys(r.data).forEach((k) => {
        normRow[normKey(k)] = r.data[k];
      });

      const code = pick(normRow, HEADERS.code);
      const name = pick(normRow, HEADERS.name);
      const alias = pick(normRow, HEADERS.alias);
      const desc = pick(normRow, HEADERS.desc);

      // Trailing/blank spreadsheet rows are ignored, not reported.
      if (!code && !name && !alias && !desc) continue;

      const label = "Excel row " + r.seq;
      if (!code && !name) {
        errors.push(label + ": Customer Code or Customer Name is required.");
        continue;
      }
      if (!alias && !desc) {
        errors.push(
          label + ": Customer Item Alias or Item Description is required.",
        );
        continue;
      }
      rows.push({ label, code, name, alias, desc });
    }

    if (rows.length === 0 && errors.length === 0) {
      this.$message.error("No data found in the imported file.");
      clearImport();
      return;
    }

    // --- 3. one customer fetch ------------------------------------------------
    // Scope to exactly what the Customer Code picker offers: organization_id is
    // deptParentId OR any of deptIds.
    const orgIds = [];
    const parentOrg = str(this.getVarGlobal("deptParentId"));
    if (parentOrg && parentOrg !== "0") orgIds.push(parentOrg);
    str(this.getVarSystem("deptIds"))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => {
        if (orgIds.indexOf(id) === -1) orgIds.push(id);
      });

    const codes = [];
    const names = [];
    rows.forEach((r) => {
      if (r.code && codes.indexOf(r.code) === -1) codes.push(r.code);
      // Only rows without a code are resolved by name.
      if (!r.code && r.name && names.indexOf(r.name) === -1) names.push(r.name);
    });

    // An empty array in an `in` filter is unsafe; "0" matches nothing.
    if (orgIds.length === 0) orgIds.push("0");
    if (codes.length === 0) codes.push("0");
    if (names.length === 0) names.push("0");

    let custData = [];
    // Nothing to look up if every row already failed validation.
    if (rows.length > 0) {
      this.showLoading("Importing Customer Binding...");
      try {
        // customer_status is deliberately NOT filtered here so an inactive
        // customer reports as "not Active" instead of "not found".
        const custRes = await db
          .collection("Customer")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "is_deleted", operator: "equal", value: 0 },
                { prop: "organization_id", operator: "in", value: orgIds },
                {
                  type: "branch",
                  operator: "any",
                  children: [
                    { prop: "customer_id", operator: "in", value: codes },
                    {
                      prop: "customer_com_name",
                      operator: "in",
                      value: names,
                    },
                  ],
                },
              ],
            },
          ])
          .get();
        custData = (custRes && custRes.data) || [];
      } finally {
        this.hideLoading();
      }
    }

    // --- 4. resolve each row --------------------------------------------------
    // The platform's `in` matching is case-insensitive (see
    // ItemAliasImportWorkflow.json), so key the maps the same way.
    const byCode = {};
    const byName = {};
    custData.forEach((c) => {
      const k1 = lc(c.customer_id);
      const k2 = lc(c.customer_com_name);
      if (k1) (byCode[k1] = byCode[k1] || []).push(c);
      if (k2) (byName[k2] = byName[k2] || []).push(c);
    });

    const warnings = [];
    const newRows = [];
    for (const r of rows) {
      const useCode = !!r.code;
      const identifier = useCode ? r.code : r.name;
      const matches = (useCode ? byCode[lc(r.code)] : byName[lc(r.name)]) || [];

      if (matches.length === 0) {
        errors.push(
          r.label +
            ": Customer " +
            (useCode ? "Code" : "Name") +
            ' "' +
            identifier +
            '" not found.',
        );
        continue;
      }
      if (matches.length > 1) {
        // By name: ask for the code instead. By code: the same code exists in
        // more than one organization in scope, which the file cannot resolve.
        errors.push(
          r.label +
            ": Customer " +
            (useCode ? "Code" : "Name") +
            ' "' +
            identifier +
            '" matches ' +
            matches.length +
            " customers" +
            (useCode
              ? " across organizations. Pick this customer manually."
              : ". Use the Customer Code instead."),
        );
        continue;
      }

      const cust = matches[0];
      if (str(cust.customer_status) !== "Active") {
        errors.push(
          r.label +
            ': Customer "' +
            identifier +
            '" is not Active (status: ' +
            (str(cust.customer_status) || "-") +
            ").",
        );
        continue;
      }

      // Code wins when both columns are filled but disagree — flag it so a
      // mis-pasted row is still visible.
      if (useCode && r.name && lc(cust.customer_com_name) !== lc(r.name)) {
        warnings.push(
          r.label +
            ': Customer Name "' +
            r.name +
            '" does not match code "' +
            r.code +
            '" (' +
            str(cust.customer_com_name) +
            "). The code was used.",
        );
      }

      newRows.push({
        customer_id: cust.id,
        customer_name: str(cust.customer_com_name),
        cust_item_alias: r.alias,
        item_desc: r.desc,
      });
    }

    // --- 5. report or commit --------------------------------------------------
    if (errors.length > 0) {
      await this.$alert(
        "The file was not imported. Fix the following and upload again:<br><br>" +
          formatList(errors),
        "Import failed",
        {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {});
      clearImport();
      return;
    }

    if (newRows.length === 0) {
      this.$message.error("No data found in the imported file.");
      clearImport();
      return;
    }

    const existing = this.getValue("table_cust_item_bind") || [];
    if (existing.length > 0) {
      try {
        await this.$confirm(
          "Importing will replace all " +
            existing.length +
            " existing customer binding row(s) with " +
            newRows.length +
            " row(s) from the file. Continue?",
          "Import Customer Binding",
          {
            confirmButtonText: "Continue",
            cancelButtonText: "Cancel",
            type: "warning",
          },
        );
      } catch (e) {
        clearImport();
        return;
      }
    }

    await this.setData({ table_cust_item_bind: newRows });

    if (warnings.length > 0) {
      await this.$alert(
        "Imported " +
          newRows.length +
          " row(s) with warnings:<br><br>" +
          formatList(warnings),
        "Imported with warnings",
        {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {});
    } else {
      this.$message.success(`Imported ${newRows.length} row(s) successfully.`);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error.message || String(error));
    console.error("Customer Binding import failed", error);
    clearImport();
  }
})();
