// Excel import for the Item form's Supplier Binding table (table_sup_item_bind).
//
// Wired to the "Import Supplier Binding" su-fm-excel-parse component
// (model: import_sup_bind) -> onUploadSuccess. The platform parses the
// spreadsheet and hands it over as arguments[0].value (numeric-keyed rows plus
// name/size/type meta keys).
//
// Supplier twin of ItemCustBindImport.js. NOT a blind rename — the collection is
// `supplier_head` (not "Supplier"), the code field is `supplier_code` (while the
// bind COLUMN is `supplier_id`, which stores the Supplier's primary id), and the
// description column is `item_description` (the customer side uses `item_desc`).
//
// Excel columns (header names are matched case/space/punctuation-insensitively):
//   Supplier Code  -- or --  Supplier Name   (at least one, code wins)
//   Supplier Item Alias / Item Description   (at least one)
//
// Validation is ALL-OR-NOTHING: one bad row aborts the whole import and the
// table is left untouched. A successful import REPLACES table_sup_item_bind
// (confirmed first when it already has rows).

(async () => {
  const clearImport = () => {
    this.setData({ import_sup_bind: "" });
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

  // Header lookup: "Supplier Item Alias" / "supplier_item_alias" / "SupItemAlias"
  // all collapse to the same key, so a hand-edited template still resolves.
  const normKey = (k) =>
    String(k || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const HEADERS = {
    code: ["suppliercode", "supcode", "supplierid"],
    name: ["suppliername", "supname", "companyname", "suppliercomname"],
    alias: ["supplieritemalias", "supitemalias", "itemalias", "alias"],
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
        errors.push(label + ": Supplier Code or Supplier Name is required.");
        continue;
      }
      if (!alias && !desc) {
        errors.push(
          label + ": Supplier Item Alias or Item Description is required.",
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

    // --- 3. one supplier fetch ------------------------------------------------
    // Scope to exactly what the Supplier Code picker offers: organization_id is
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

    let supData = [];
    // Nothing to look up if every row already failed validation.
    if (rows.length > 0) {
      this.showLoading("Importing Supplier Binding...");
      try {
        // The collection is supplier_head, NOT "Supplier" — see
        // GRonChangeSupplier.js / SupplierSave.js.
        // supplier_status is deliberately NOT filtered here so an inactive
        // supplier reports as "not Active" instead of "not found". is_deleted is
        // filtered in JS below rather than in the query: no existing
        // supplier_head caller filters on it, so don't assume the column exists.
        const supRes = await db
          .collection("supplier_head")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "organization_id", operator: "in", value: orgIds },
                {
                  type: "branch",
                  operator: "any",
                  children: [
                    { prop: "supplier_code", operator: "in", value: codes },
                    {
                      prop: "supplier_com_name",
                      operator: "in",
                      value: names,
                    },
                  ],
                },
              ],
            },
          ])
          .get();
        supData = ((supRes && supRes.data) || []).filter(
          (s) => s.is_deleted !== 1,
        );
      } finally {
        this.hideLoading();
      }
    }

    // --- 4. resolve each row --------------------------------------------------
    // The platform's `in` matching is case-insensitive (see
    // ItemAliasImportWorkflow.json), so key the maps the same way.
    const byCode = {};
    const byName = {};
    supData.forEach((s) => {
      const k1 = lc(s.supplier_code);
      const k2 = lc(s.supplier_com_name);
      if (k1) (byCode[k1] = byCode[k1] || []).push(s);
      if (k2) (byName[k2] = byName[k2] || []).push(s);
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
            ": Supplier " +
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
            ": Supplier " +
            (useCode ? "Code" : "Name") +
            ' "' +
            identifier +
            '" matches ' +
            matches.length +
            " suppliers" +
            (useCode
              ? " across organizations. Pick this supplier manually."
              : ". Use the Supplier Code instead."),
        );
        continue;
      }

      const sup = matches[0];
      if (str(sup.supplier_status) !== "Active") {
        errors.push(
          r.label +
            ': Supplier "' +
            identifier +
            '" is not Active (status: ' +
            (str(sup.supplier_status) || "-") +
            ").",
        );
        continue;
      }

      // Code wins when both columns are filled but disagree — flag it so a
      // mis-pasted row is still visible.
      if (useCode && r.name && lc(sup.supplier_com_name) !== lc(r.name)) {
        warnings.push(
          r.label +
            ': Supplier Name "' +
            r.name +
            '" does not match code "' +
            r.code +
            '" (' +
            str(sup.supplier_com_name) +
            "). The code was used.",
        );
      }

      newRows.push({
        supplier_id: sup.id,
        supplier_name: str(sup.supplier_com_name),
        sup_item_alias: r.alias,
        item_description: r.desc,
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

    const existing = this.getValue("table_sup_item_bind") || [];
    if (existing.length > 0) {
      try {
        await this.$confirm(
          "Importing will replace all " +
            existing.length +
            " existing supplier binding row(s) with " +
            newRows.length +
            " row(s) from the file. Continue?",
          "Import Supplier Binding",
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

    await this.setData({ table_sup_item_bind: newRows });

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
    console.error("Supplier Binding import failed", error);
    clearImport();
  }
})();
