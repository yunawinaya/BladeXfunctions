const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    // Check for the specific error structure: { "table_so.1dz9gq2q.so_item_price": { "message": "..." } }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];
        // If value has a message property, return it
        if (value && typeof value === "object" && value.message) {
          return value.message;
        }
        // Recursively search
        const found = findFieldMessage(value);
        if (found) return found;
      }
    }
  }
  return null;
};

const submitForm = async (data) => {
  await this.runWorkflow(
    "1988908545345945602",
    {
      allData: data,
    },
    async (res) => {
      console.log("res", res);
      if (res.enteredSlotApproval) {
        await this.$alert(
          "This Sales Order requires approval.<br><br>Please wait for approval and it will be save as draft.",
          "Approval Required",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "info",
          },
        );
      }
      // A gate (414 / 413 / 406) now returns HTTP 200 with the code in the body, so the
      // platform raises no error toast beside the dialog. Handle it before anything here
      // treats this as a saved order. The error-callback branches below still stand, so a
      // stale workflow deploy keeps working.
      // runWorkflow hands back the whole envelope: {code, data:{data:{...}}} -- the inner
      // `data` is the end-node's OutputParams prop, so the payload sits one level deeper
      // than it looks. Tolerate both shapes rather than depending on the wrapping.
      const payload = res?.data?.data ?? res?.data ?? {};
      const gateCode = payload.gateCode;
      if (gateCode) {
        this.hideLoading();
        const gateMsg = `${payload.message || ""}`;
        if (gateCode === "414" || gateCode === 414) {
          const addToDelivery = await this.$confirm(
            gateMsg,
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
          data.raiseGdQty = addToDelivery;
          await submitForm(data);
          return;
        }
        if (gateCode === "413" || gateCode === 413) {
          await this.$confirm(gateMsg, `Reverse picked quantities`, {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          }).catch(() => {
            this.hideLoading();
            throw new Error("Saving sales order cancelled.");
          });
          this.showLoading("Saving Sales Order...");
          data.confirmPickReversal = "Yes";
          await submitForm(data);
          return;
        }
        await this.$alert(gateMsg, `Linked documents`, {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
        return;
      }

      // What has to be physically put back after a pick reversal, as the delivery
      // reported it.
      if (payload.pickingReversalNote) {
        await this.$alert(payload.pickingReversalNote, "Stock to put back", {
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
  // 必须大于 0 的列（required 对数字 0 是放行的，得自己判）
  const POSITIVE_COLUMNS = {
    so_quantity: "Quantity must be greater than 0.",
  };

  try {
    this.showLoading("Saving Sales Order...");

    // 整个子表这两列、所有行；不通过的单元格会标红
    const res = await this.validateByColName(Object.keys(POSITIVE_COLUMNS), {
      validator: (value, row, ctx) =>
        Number(value) > 0 || POSITIVE_COLUMNS[ctx.field],
    });
    if (!res.valid) {
      const lines = res.errors
        .slice(0, 3)
        .map((e) => `Line ${e.rowNo} · ${e.columnLabel}: ${e.message}`);
      if (res.errors.length > 3) lines.push(`(+${res.errors.length - 3} more)`);
      this.$message.error(lines.join(";"));
      return;
    }

    const entry = this.getValues();

    entry.so_status =
      entry.so_status === "Processing" ? entry.so_status : "Issued";
    if (!entry.previous_status || entry.previous_status === "Draft") {
      entry.production_status = "Not Created";
    }

    await submitForm(entry);
  } catch (error) {
    console.error("Submit Sales Order failed:", error);
    // runWorkflow rejects AFTER its error callback has run, so anything carrying a
    // workflow code was already reported there -- as a confirm, or as its own alert.
    // Reporting it again here also renders the raw <br> tags, because $message takes
    // no dangerouslyUseHTMLString. A cancellation or a validation failure is a plain
    // Error with no .data, so those still surface.
    if (!(error && error.data && error.data.code)) {
      const msg =
        (error && typeof error === "object"
          ? error.message || findFieldMessage(error)
          : "") || String(error);
      this.$message.error(
        msg && msg !== "[object Object]"
          ? msg
          : "Save failed, please try again.",
      );
    }
  } finally {
    this.hideLoading();
  }
})();
