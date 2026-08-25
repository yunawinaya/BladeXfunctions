const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const submitForm = async (data) => {
  await this.runWorkflow(
    "1988908545345945602",
    {
      allData: data,
    },
    async (res) => {
      // What has to be physically put back after a pick reversal, as the delivery
      // reported it.
      if (res?.data?.pickingReversalNote) {
        await this.$alert(res.data.pickingReversalNote, "Stock to put back", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });
      }
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    },
    async (error) => {
      this.hideLoading();
      console.error(error);
      if (error.data?.code === 402) {
        // 402 - Credit limit block
        const cleanMessage = error.data?.msg.replace(/^Block - /, "");

        await this.$alert(`${cleanMessage}`, "", {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      } else if (error.data?.code === 403) {
        // 403 - Credit limit override
        const cleanMessage = error.data?.msg.replace(/^Override - /, "");
        await this.$confirm(`${cleanMessage}`, ``, {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving purchase order cancelled.");
        });

        this.showLoading("Saving Sales Order...");
        data.need_cl = "not required";

        await submitForm(data);
      } else if (error.data?.code === 404) {
        // 404 - Existing Draft GD/SI
        await this.$confirm(
          `${error.data.msg}<br><br><strong>Do you wish to continue?</strong>`,
          `Existing draft records detected`,
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "error",
            dangerouslyUseHTMLString: true,
          },
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving sales order cancelled.");
        });
        this.showLoading("Saving Sales Order...");
        await this.runWorkflow(
          "2000407100609073154",
          { so_id: data.id },
          async (res) => {
            await submitForm(data);
          },
          (error) => {
            this.hideLoading();
            this.$message.error(error || error.toString());
            console.error(error);
          },
        );
      } else if (error.data?.code === 405) {
        // 405 - Create SI with 0 total amount
        await this.$confirm(`${error.data.msg}`, `0 total amount detected`, {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving sales order cancelled.");
        });
        this.showLoading("Saving Sales Order...");
        data.create_si = "Yes";

        await submitForm(data);
      } else if (error.data?.code === 414) {
        // 414 - The order quantity went up. Both answers re-run the save; closing the
        // dialog counts as "leave outstanding", so nothing extra is ever allocated.
        const addToDelivery = await this.$confirm(
          `${error.data.msg}`,
          `Delivery quantity`,
          {
            confirmButtonText: "Add to delivery",
            cancelButtonText: "Leave outstanding",
            type: "warning",
            dangerouslyUseHTMLString: true,
          },
        )
          .then(() => "Yes")
          .catch(() => "No");

        this.showLoading("Saving Sales Order...");
        // Kept on data so a following 413 retry cannot drop the answer.
        data.raiseGdQty = addToDelivery;

        await submitForm(data);
      } else if (error.data?.code === 413) {
        // 413 - Reducing this order reverses quantities already picked.
        await this.$confirm(`${error.data.msg}`, `Reverse picked quantities`, {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving sales order cancelled.");
        });
        this.showLoading("Saving Sales Order...");
        data.confirmPickReversal = "Yes";

        await submitForm(data);
      } else if (error.data?.code === 406) {
        // 406 - A linked delivery or picking plan refused the change. The message names
        // each document and says whether the order itself was saved.
        await this.$alert(`${error.data.msg}`, `Linked documents`, {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      } else {
        // 400 and 401 showed the user nothing at all before this.
        this.$message.error(error.data?.msg || "Failed to save Sales Order.");
      }
    },
  );
};

(async () => {
  this.showLoading("Saving Sales Order...");
  const data = this.getValues();
  let entry = data;

  for (const [index, soLineItem] of entry.table_so.entries()) {
    await this.validate(`table_so.${index}.so_item_price`);
  }

  entry.so_status =
    entry.so_status === "Processing" ? entry.so_status : "Issued";
  if (!entry.previous_status || entry.previous_status === "Draft") {
    entry.production_status = "Not Created";
  }

  await submitForm(entry);
})();
