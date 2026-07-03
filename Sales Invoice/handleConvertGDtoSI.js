const handleConvertSI = async (
  selectedRecords,
  convertTo,
  isMultiple,
  filterDraft,
) => {
  // Block combining internal-trading and non-internal Goods Deliveries into ONE
  // Sales Invoice. Only relevant for single-SI conversion of 2+ GDs; "multiple"
  // gives each GD its own SI (no mix). Internal = the GD is the source of a
  // "Linked" GD->GR row in document_linkage.
  if (isMultiple === "single" && selectedRecords.length > 1) {
    const gdIds = [...new Set(selectedRecords.map((r) => r.id))];
    const linkRes = await db
      .collection("document_linkage")
      .filter([
        {
          type: "branch",
          operator: "all",
          children: [
            {
              prop: "source_doc_type",
              operator: "equal",
              value: "Goods Delivery",
            },
            { prop: "source_doc_id", operator: "in", value: gdIds },
            { prop: "link_status", operator: "equal", value: "Linked" },
          ],
        },
      ])
      .get();

    const internalSet = new Set(
      (linkRes?.data || []).map((r) => r.source_doc_id),
    );
    const internalCount = gdIds.filter((id) => internalSet.has(id)).length;

    if (internalCount > 0 && internalCount < gdIds.length) {
      await this.$alert(
        "Cannot combine internal trading and non-internal Goods Deliveries in the same Sales Invoice. Please select only one type, or convert to multiple Sales Invoices.",
        "Error",
        { confirmButtonText: "OK", type: "error" },
      );
      return;
    }
  }

  this.showLoading("Converting Goods Delivery to Sales Invoice...");
  await this.runWorkflow(
    "2070069049332416514",
    {
      ids: selectedRecords.map((record) => record.id),
      convert_to: convertTo,
      is_multiple: isMultiple,
      filter_draft: filterDraft,
    },
    async (res) => {
      console.log("SI Data", res.data);
      this.$alert(
        "Convert Goods Delivery to Sales Invoice Success",
        "Success",
        {
          confirmButtonText: "OK",
          type: "success",
        },
      );
      this.refresh();
      this.hideLoading();
    },
    async (err) => {
      console.error(err);
      this.hideLoading();
      if (err.data?.code === 401) {
        // Draft SO cannot be converted.
        await this.$confirm(err.data.msg, "GD cannot be converted.", {
          confirmButtonText: "Proceed",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Converting sales invoice cancelled.");
        });

        await handleConvertSI(selectedRecords, convertTo, isMultiple, "yes");
      } else if (err.data?.code === 402) {
        // Selected Goods Delivery(s) already has a related Sales Invoice and cannot be converted.
        await this.$alert(err.data.msg, "Error", {
          confirmButtonText: "OK",
          type: "error",
        });
      } else if (err.data?.code === 403) {
        // All selected Goods Delivery(s) must be from the same plant/organization to create a single Sales Invoice.
        await this.$confirm(err.data.msg, "", {
          confirmButtonText: "Convert to Multiple SI",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Converting sales invoice cancelled.");
        });

        await handleConvertSI(
          selectedRecords,
          convertTo,
          "multiple",
          filterDraft,
        );
      }
    },
  );
  this.hideLoading();
};

(async () => {
  try {
    const allListID = "custom_ezwb0qqp";
    let selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;
    let convertTo = "";
    let isMultiple = "single";

    if (selectedRecords && selectedRecords.length > 0) {
      await this.$confirm(
        `Would you like to convert these into 'Draft' or 'Completed' sales invoices?<br><br>`,
        "Confirm Conversion",
        {
          confirmButtonText: "Draft SI",
          cancelButtonText: "Completed SI",
          dangerouslyUseHTMLString: true,
          type: "info",
          distinguishCancelAndClose: true,
          beforeClose: async (action, instance, done) => {
            if (action === "confirm") {
              convertTo = "draft";
              done();
            } else if (action === "cancel") {
              convertTo = "completed";
              if (selectedRecords.length > 1) {
                done();
                await this.$confirm(
                  `Would you like to convert these into a single sales invoice or into multiple sales invoices?<br><br>
          <strong>Selected Records:</strong><br> ${selectedRecords
            .map((item) => item.delivery_no)
            .join("<br>")}`,
                  "Confirm Conversion",
                  {
                    confirmButtonText: "Single SI",
                    cancelButtonText: "Multiple SIs",
                    dangerouslyUseHTMLString: true,
                    type: "info",
                    distinguishCancelAndClose: true,
                    beforeClose: async (action, instance, done) => {
                      if (action === "confirm") {
                        isMultiple = "single";
                        done();
                      } else if (action === "cancel") {
                        isMultiple = "multiple";
                        await handleConvertSI(
                          selectedRecords,
                          convertTo,
                          isMultiple,
                          "no",
                        );

                        done();
                      } else {
                        done();
                      }
                    },
                  },
                );
              }

              await handleConvertSI(
                selectedRecords,
                convertTo,
                isMultiple,
                "no",
              );

              done();
            } else {
              done();
            }
          },
        },
      );

      if (selectedRecords.length > 1) {
        await this.$confirm(
          `Would you like to convert these into a single sales invoice or into multiple sales invoices?<br><br>
          <strong>Selected Records:</strong><br> ${selectedRecords
            .map((item) => item.delivery_no)
            .join("<br>")}`,
          "Confirm Conversion",
          {
            confirmButtonText: "Single SI",
            cancelButtonText: "Multiple SIs",
            dangerouslyUseHTMLString: true,
            type: "info",
            distinguishCancelAndClose: true,
            beforeClose: async (action, instance, done) => {
              if (action === "confirm") {
                isMultiple = "single";
                done();
              } else if (action === "cancel") {
                isMultiple = "multiple";
                await handleConvertSI(
                  selectedRecords,
                  convertTo,
                  isMultiple,
                  "no",
                );

                done();
              } else {
                done();
              }
            },
          },
        );
      }

      await handleConvertSI(selectedRecords, convertTo, isMultiple, "no");
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
