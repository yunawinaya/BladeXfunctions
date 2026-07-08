// Item Alias Excel import.
//
// The platform parses the uploaded spreadsheet into `dialog_import.import_data`
// (numeric-keyed rows plus name/size/type meta keys). Unlike the Goods Receiving
// import (which fills a form table via setData and defers the DB write to save),
// Item Alias has no deferred save: the workflow resolves names -> ids, derives /
// validates each buyer & seller UOM, enforces the same rules as ItemAliasSave.js
// (buyer org != seller org, per-seller uniqueness), then inserts every valid row
// straight into the item_alias collection.
//
// Duplicates (a row matching an existing active alias, or two rows in the file
// with the same buyer-org/seller-org/buyer-item/buyer-UOM key) are skipped-and-
// warned: the first pass returns 409 with the list; on confirm we re-run with
// skipDuplicates = "true" and insert the rest.

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

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Run the workflow; skipDuplicates toggles the 409 confirm -> skip flow.
    const runImport = async (skipDuplicates) => {
      const payload = {
        import_data: JSON.stringify(importData),
        organization_id: organizationId,
        skipDuplicates: skipDuplicates ? "true" : "false",
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
              if (out.warning) {
                this.$message.warning(out.warning);
              }
              this.$message.success(`Imported ${inserted} item alias(es).`);
              closeAndRefresh();
            } else if (code === "409") {
              // Duplicates need confirmation. On confirm, re-run skipping them.
              try {
                await this.$confirm(
                  out.message || "Some rows are duplicates. Continue and skip them?",
                  "Duplicate aliases found",
                  {
                    confirmButtonText: "Continue",
                    cancelButtonText: "Cancel",
                    type: "warning",
                  },
                );
              } catch (e) {
                // Cancelled: keep the upload so the user can fix the file.
                return;
              }
              await runImport(true);
            } else {
              // 400 (or anything else): validation failure, nothing inserted.
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
