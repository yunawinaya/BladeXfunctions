// Item Alias Excel import.
//
// The platform parses the uploaded spreadsheet into `dialog_import.import_data`
// (numeric-keyed rows plus name/size/type meta keys). Unlike the Goods Receiving
// import (which fills a form table via setData and defers the DB write to save),
// Item Alias has no deferred save: the workflow resolves names -> ids (case-
// insensitively, scoped to the buyer/seller org), derives/validates each buyer &
// seller UOM, enforces the same rules as ItemAliasSave.js (buyer org != seller org,
// per-seller uniqueness), then bulk-inserts the new rows into item_alias.
//
// When a row matches an EXISTING active alias, the first pass returns 409 with the
// list; the user confirms once (bulk), we re-run with updateExisting = "true", and
// the existing rows are updated (seller item/UOM + conversion rate) while the new
// rows are inserted. Rows duplicated WITHIN the file are skipped and reported.
// organization_id is not sent: item_alias is tenant-level and the platform sets it.

// Deployed workflow id for ItemAliasImportWorkflow.json.
const ITEM_ALIAS_IMPORT_WORKFLOW_ID = "2074702385267085314";

(async () => {
  const clearImport = () => {
    this.setData({ "dialog_import.import_data": "" });
  };

  // Runs at LIST PAGE level (not inside a form), so `this` is the page that owns
  // `dialog_import`: closeDialog dismisses the import dialog and refresh reloads
  // the alias list.
  const closeAndRefresh = () => {
    clearImport();
    this.closeDialog("dialog_import");
    this.refresh();
  };

  try {
    const importData = this.models.dialog_import.import_data || {};

    // Guard: no data rows in the parsed payload.
    const hasRows = Object.keys(importData).some((k) => /^\d+$/.test(k));
    if (!hasRows) {
      this.$message.error("No data found in the imported file.");
      clearImport();
      return;
    }

    // updateExisting toggles the 409 confirm -> update-existing flow.
    const runImport = async (updateExisting) => {
      const payload = {
        import_data: JSON.stringify(importData),
        updateExisting: updateExisting ? "true" : "false",
      };

      this.showLoading("Importing Item Alias...");

      await this.runWorkflow(
        ITEM_ALIAS_IMPORT_WORKFLOW_ID,
        payload,
        async (res) => {
          this.hideLoading();
          try {
            // Return keys may sit at res.data or res.data.data depending on the
            // platform envelope (see POsaveAsIssued.js / GRtableImportSuccess.js).
            const out =
              (res && res.data && res.data.data) || (res && res.data) || {};
            const code = String(out.code);

            if (code === "200") {
              const inserted = out.inserted || "0";
              const updated = out.updated || "0";
              if (out.warning) {
                this.$message.warning(out.warning);
              }
              let summary = `Imported ${inserted} item alias(es)`;
              if (Number(updated) > 0) summary += `, updated ${updated}`;
              this.$message.success(summary + ".");
              closeAndRefresh();
            } else if (code === "409") {
              // Existing aliases found: confirm once (bulk) to update them.
              try {
                await this.$confirm(
                  out.message ||
                    "Some aliases already exist. Update them and import the rest?",
                  "Existing aliases found",
                  {
                    confirmButtonText: "Update & Import",
                    cancelButtonText: "Cancel",
                    type: "warning",
                  },
                );
              } catch (e) {
                // Cancelled: keep the upload so the user can adjust the file.
                return;
              }
              await runImport(true);
            } else {
              // 400 (or anything else): validation failure, nothing written.
              this.$message.error(out.message || "Import validation failed.");
            }
          } catch (err) {
            this.$message.error(err.message || String(err));
          }
        },
        async (error) => {
          this.hideLoading();
          this.$message.error(
            (error && error.data && error.data.msg) ||
              (error && error.message) ||
              String(error),
          );
        },
      );
    };

    await runImport(false);
  } catch (error) {
    this.hideLoading();
    this.$message.error(error.message || String(error));
    console.error("Error:", error);
  }
})();
