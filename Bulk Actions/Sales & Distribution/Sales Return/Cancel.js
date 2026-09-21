const idOf = (value) => (value && typeof value === "object" ? value.id : value);

// goods_delivery_fwii8mvb_sub.return_qty is a varchar; the save workflow writes
// it as a 3-decimal string, so the reversal has to match that format.
const formatQty = (value) => (parseFloat(value) || 0).toFixed(8);

// sales_order_axszx8cj_sub.return_qty is decimal(65,8) and the SO form declares 8
// decimals, so the reversal writes back at the scale the save workflow used.
const formatSOQty = (value) => (parseFloat(value) || 0).toFixed(8);

const EPS = 0.0005;

// table_sr is a tree: an item bundle is ONE row with the bundle's items under
// `children`. The save workflow books every one of those items onto its own order
// line, so the reversal has to see them too or a bundle's return never comes off.
const flattenRows = (rows) =>
  (rows || []).flatMap((row) => [
    row,
    ...(Array.isArray(row.children) ? row.children : []),
  ]);

const lineReturnStatus = (returnQty, gdQty) => {
  if (parseFloat(returnQty || 0) <= 0) return "";
  return parseFloat(returnQty || 0) >= parseFloat(gdQty || 0)
    ? "Fully Returned"
    : "Partially Returned";
};

// sales_return_receiving.sr_id is a JSON array column, so each sales return has
// to be matched on its own rather than with one id-list query.
const fetchDraftSRR = async (selectedRecords) => {
  const draftSRRBySR = new Map();

  await Promise.all(
    selectedRecords.map((sr) =>
      db
        .collection("sales_return_receiving")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "sr_id", operator: "in", value: sr.id },
              { prop: "srr_status", operator: "equal", value: "Draft" },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ])
        .get()
        .then((response) => {
          const srrList = response?.data || [];
          if (srrList.length > 0) {
            draftSRRBySR.set(sr.id, {
              sales_return_no: sr.sales_return_no,
              srrIds: srrList.map((srr) => srr.id),
            });
          }
        }),
    ),
  );

  console.log("sales returns with draft SRR:", Array.from(draftSRRBySR.keys()));
  return draftSRRBySR;
};

const fetchSalesReturnData = async (srIds) => {
  const resSR = await db
    .collection("sales_return")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [{ prop: "id", operator: "in", value: srIds }],
      },
    ])
    .get();

  return resSR?.data || [];
};

const fetchGDLineData = async (gdLineIds) => {
  if (gdLineIds.length === 0) return new Map();

  const resGDLine = await db
    .collection("goods_delivery_fwii8mvb_sub")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [{ prop: "id", operator: "in", value: gdLineIds }],
      },
    ])
    .get();

  return new Map((resGDLine?.data || []).map((line) => [line.id, line]));
};

// Reverses what the SR save workflow added: return_qty and the line level
// sr_status on every goods delivery line the sales return touched.
const fetchSOLineData = async (soLineIds) => {
  if (soLineIds.length === 0) return new Map();

  const resSOLine = await db
    .collection("sales_order_axszx8cj_sub")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [{ prop: "id", operator: "in", value: soLineIds }],
      },
    ])
    .get();

  return new Map((resSOLine?.data || []).map((line) => [line.id, line]));
};

// Reverses what the SR save workflow added to the order line: return_qty. The
// order's own statuses are recomputed afterwards, once every selected return has
// been reversed.
const reverseSOLines = async (srData, soLineById) => {
  const updates = [];

  for (const item of flattenRows(srData.table_sr)) {
    const soLineId = idOf(item.so_line_id);
    const soLine = soLineById.get(soLineId);
    if (!soLine) continue;

    const newReturnQty = Math.max(
      0,
      parseFloat(soLine.return_qty || 0) -
        parseFloat(item.expected_return_qty || 0),
    );

    // Two selected sales returns can share an order line, so keep the cached
    // copy in step with what has already been written.
    soLine.return_qty = formatSOQty(newReturnQty);

    updates.push(
      db
        .collection("sales_order_axszx8cj_sub")
        .doc(soLineId)
        .update({ return_qty: formatSOQty(newReturnQty) }),
    );
  }

  await Promise.all(updates);
};

const reverseGDLines = async (srData, gdLineById) => {
  const updates = [];

  for (const item of srData.table_sr || []) {
    const gdLineId = idOf(item.gd_line_id);
    const gdLine = gdLineById.get(gdLineId);
    if (!gdLine) continue;

    const newReturnQty = Math.max(
      0,
      parseFloat(gdLine.return_qty || 0) -
        parseFloat(item.expected_return_qty || 0),
    );

    // Two selected sales returns can share a goods delivery line, so keep the
    // cached copy in step with what has already been written.
    gdLine.return_qty = formatQty(newReturnQty);

    updates.push(
      db
        .collection("goods_delivery_fwii8mvb_sub")
        .doc(gdLineId)
        .update({
          return_qty: formatQty(newReturnQty),
          sr_status: lineReturnStatus(newReturnQty, gdLine.gd_qty),
        }),
    );
  }

  await Promise.all(updates);
};

const refreshGDStatus = async (gdIds) => {
  if (gdIds.length === 0) return;

  const resGD = await db
    .collection("goods_delivery")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [{ prop: "id", operator: "in", value: gdIds }],
      },
    ])
    .get();

  await Promise.all(
    (resGD?.data || []).map((gd) => {
      const gdLines = gd.table_gd || [];
      const totalReturnQty = gdLines.reduce(
        (sum, line) => sum + parseFloat(line.return_qty || 0),
        0,
      );

      let updatedGDStatus = "";
      if (totalReturnQty > 0) {
        updatedGDStatus = gdLines.some(
          (line) =>
            parseFloat(line.return_qty || 0) < parseFloat(line.gd_qty || 0),
        )
          ? "Partially Returned"
          : "Fully Returned";
      }

      return db.collection("goods_delivery").doc(gd.id).update({
        sr_status: updatedGDStatus,
      });
    }),
  );
};

const refreshSOStatus = async (soIds) => {
  if (soIds.length === 0) return;

  const resSOLine = await db
    .collection("sales_order_axszx8cj_sub")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [{ prop: "sales_order_id", operator: "in", value: soIds }],
      },
    ])
    .get();

  const linesBySO = new Map();

  for (const line of resSOLine?.data || []) {
    const key = String(line.sales_order_id);
    if (!linesBySO.has(key)) linesBySO.set(key, []);
    linesBySO.get(key).push(line);
  }

  await Promise.all(
    soIds.map(async (soId) => {
      const soLines = linesBySO.get(String(soId)) || [];

      const totalReturnQty = soLines.reduce(
        (sum, line) => sum + parseFloat(line.return_qty || 0),
        0,
      );

      let srStatus = "";
      let srrStatus = "";

      if (totalReturnQty > 0) {
        // A line nothing was ever delivered against cannot be returned, so it is
        // not allowed to hold the order open at Partially Returned.
        const delivered = soLines.filter(
          (line) => parseFloat(line.delivered_qty || 0) > 0,
        );

        srStatus =
          delivered.length > 0 &&
          delivered.every(
            (line) =>
              parseFloat(line.return_qty || 0) -
                parseFloat(line.delivered_qty || 0) >=
              -EPS,
          )
            ? "Fully Returned"
            : "Partially Returned";

        // sales_return.so_id is a JSON array column, so each order is matched on
        // its own -- the same shape fetchDraftSRR uses for sr_id. This runs after
        // the loop has marked the selected returns Cancelled, so they drop out.
        const resSR = await db
          .collection("sales_return")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "so_id", operator: "in", value: soId },
                { prop: "is_deleted", operator: "equal", value: 0 },
              ],
            },
          ])
          .get();

        const surviving = (resSR?.data || []).filter(
          (sr) => sr.sr_status !== "Cancelled",
        );

        if (surviving.length > 0) {
          srrStatus = surviving.some((sr) =>
            flattenRows(sr.table_sr).some(
              (line) =>
                parseFloat(line.expected_return_qty || 0) -
                  parseFloat(line.received_qty || 0) >
                EPS,
            ),
          )
            ? "Partially Received"
            : "Fully Received";
        }
      }

      return db
        .collection("sales_order")
        .doc(soId)
        .update({
          sr_status: srStatus,
          srr_status: srrStatus,
          has_sr: srStatus === "" ? 0 : 1,
        });
    }),
  );
};

(async () => {
  try {
    const unCompletedListID = "custom_sx3wmtii";
    const allListID = "custom_qnowgkx8";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted",
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID,
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (!selectedRecords || selectedRecords.length === 0) {
      this.$message.error("Please select at least one record.");
      return;
    }

    selectedRecords = selectedRecords.filter(
      (item) => item.sr_status === "Issued",
    );

    console.log("selectedRecords", selectedRecords);
    if (selectedRecords.length === 0) {
      this.$message.error("Please select at least one issued sales return.");
      return;
    }

    const salesReturnNumbers = selectedRecords.map(
      (item) => item.sales_return_no,
    );

    await this.$confirm(
      `You've selected ${
        salesReturnNumbers.length
      } sales return(s) to cancel. <br> <strong>Sales Return Numbers:</strong> <br>${salesReturnNumbers.join(
        ", ",
      )} <br>Do you want to proceed?`,
      "Sales Return Cancellation",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    const draftSRRBySR = await fetchDraftSRR(selectedRecords);

    // if has existing draft sales return receiving, pop dialog before deleting them
    if (draftSRRBySR.size > 0) {
      const srNumbersWithDraftSRR = Array.from(draftSRRBySR.values()).map(
        (entry) => entry.sales_return_no,
      );

      await this.$confirm(
        `${srNumbersWithDraftSRR.join(
          ", ",
        )} has existing Draft Sales Return Receiving. Proceed will delete all associated Sales Return Receiving.
        <br><br> <strong>Do you wish to continue?</strong>`,
        "Existing Sales Return Receiving(s) Detected",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });
    }

    this.showLoading("Cancelling Sales Return...");

    // The list row only carries display values, so re-read the sales returns to
    // get table_sr and the raw goods delivery ids.
    const srDataList = await fetchSalesReturnData(
      selectedRecords.map((item) => item.id),
    );

    const gdLineIds = Array.from(
      new Set(
        srDataList.flatMap((srData) =>
          (srData.table_sr || [])
            .map((item) => idOf(item.gd_line_id))
            .filter(Boolean),
        ),
      ),
    );

    const soLineIds = Array.from(
      new Set(
        srDataList.flatMap((srData) =>
          flattenRows(srData.table_sr)
            .map((item) => idOf(item.so_line_id))
            .filter(Boolean),
        ),
      ),
    );

    const [gdLineById, soLineById] = await Promise.all([
      fetchGDLineData(gdLineIds),
      fetchSOLineData(soLineIds),
    ]);

    const failedSR = [];
    const touchedGDIds = new Set();
    const touchedSOIds = new Set();

    for (const srData of srDataList) {
      try {
        // Reverse the goods delivery first: if it throws, the sales return stays
        // Issued and the cancellation can be retried.
        await reverseGDLines(srData, gdLineById);
        await reverseSOLines(srData, soLineById);

        await db.collection("sales_return").doc(srData.id).update({
          sr_status: "Cancelled",
        });

        const draftSRR = draftSRRBySR.get(srData.id);
        if (draftSRR) {
          await Promise.all(
            draftSRR.srrIds.map((srrId) =>
              db.collection("sales_return_receiving").doc(srrId).update({
                is_deleted: 1,
              }),
            ),
          );
        }

        (srData.gd_id || []).map(idOf).forEach((gdId) => {
          if (gdId) touchedGDIds.add(gdId);
        });

        // Taken from the lines rather than the header array: these are the very
        // ids the save workflow wrote against.
        flattenRows(srData.table_sr)
          .map((item) => idOf(item.so_id))
          .forEach((soId) => {
            if (soId) touchedSOIds.add(soId);
          });
      } catch (error) {
        console.error(
          `Error cancelling sales return ${srData.sales_return_no}:`,
          error,
        );
        failedSR.push(srData.sales_return_no);
      }
    }

    await refreshGDStatus(Array.from(touchedGDIds));
    await refreshSOStatus(Array.from(touchedSOIds));

    this.hideLoading();

    if (failedSR.length > 0) {
      this.$message.error(
        `Failed to cancel ${failedSR.length} sales return(s): ${failedSR.join(
          ", ",
        )}`,
      );
    } else {
      this.$message.success(
        `Successfully cancelled ${srDataList.length} sales return(s).`,
      );
    }

    this.refresh();
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
