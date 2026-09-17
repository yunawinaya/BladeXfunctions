(async () => {
  const ITEM_BULK_IMPORT_WORKFLOW_ID = "2100466107330400257";

  const DIALOG = "dialog_item_import";
  const FILE_FIELD = DIALOG + ".import_file";

  const clearImport = () => {
    this.setData({ [FILE_FIELD]: "" });
    this.hide([DIALOG + ".import_ok_text", DIALOG + ".import_fail_text"]);
  };

  // The workflow already escapes the values it interpolates, but anything this
  // file adds to an HTML alert goes through here too.
  const escapeHtml = (s) =>
    String(s === undefined || s === null ? "" : s).replace(
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

  try {
    const file = this.getValue(FILE_FIELD);

    // The parser emits an object keyed "0","1","2"... plus name/size/type meta
    // keys, so "has rows" is "has at least one numeric key".
    const hasRows =
      Array.isArray(file)
        ? file.length > 0
        : !!file &&
          typeof file === "object" &&
          Object.keys(file).some((k) => /^\d+$/.test(k));

    if (!hasRows) {
      this.$message.error("Upload an Excel file before importing.");
      return;
    }

    // "0" is the platform's "not set" sentinel and is truthy in JS, so it needs
    // its own check -- same fallback ItemOnMounted.js uses.
    let organizationId = this.getVarGlobal("deptParentId");
    if (!organizationId || organizationId === "0") {
      organizationId = String(this.getVarSystem("deptIds") || "").split(",")[0];
    }

    if (!organizationId) {
      this.$message.error("Organization is required to import items.");
      return;
    }

    this.showLoading("Importing Items...");

    this.runWorkflow(
      ITEM_BULK_IMPORT_WORKFLOW_ID,
      {
        import_file: JSON.stringify(file),
        organization_id: organizationId,
      },
      (res) => {
        this.hideLoading();

        const out = (res && res.data && res.data.data) || (res && res.data) || {};
        const code = String(out.code || "");
        const message = out.message || "";

        if (code === "402") {
          // Some rows were created and some were not. Keep the dialog open so
          // the file is still in front of the user, and refresh so the Item
          // list shows exactly what landed.
          this.refresh();
          this.$alert(escapeHtml(message), "Imported with problems", {
            dangerouslyUseHTMLString: true,
            confirmButtonText: "OK",
          }).catch(() => {});
          return;
        }

        this.$message.success(message || "Items imported successfully.");
        clearImport();
        this.closeDialog(DIALOG);
        this.refresh();
      },
      (err) => {
        this.hideLoading();
        console.error("Item bulk import failed", err);

        // code_parse and code_build both block the whole file with 401 and an
        // HTML-formatted list of what to fix.
        const detail = (err && err.data) || {};
        if (Number(detail.code) === 401 && detail.msg) {
          this.$alert(detail.msg, "Import failed", {
            dangerouslyUseHTMLString: true,
            confirmButtonText: "OK",
          }).catch(() => {});
        } else {
          this.$message.error(detail.msg || "Failed to import items.");
        }
        clearImport();
      },
    );
  } catch (error) {
    this.hideLoading();
    console.error("Item bulk import failed", error);
    this.$message.error(error.message || String(error));
    clearImport();
  }
})();
