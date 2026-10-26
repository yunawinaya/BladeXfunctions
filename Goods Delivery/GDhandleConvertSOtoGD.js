// picking_setup.convert_gd_created = 1 makes a Multiple-GDs conversion save straight to
// Created, server-side, via SOconvertGDCreatedWorkflow (gates for that path -- picking mode,
// shortfall, credit limit -- live in the workflow). A single GD always opens the form for
// review instead, so the flag never applies to it.

const CONVERT_GD_CREATED_WORKFLOW_ID = "2076557490389835777";
const CONVERT_GD_DRAFT_WORKFLOW_ID = "1985267806223810561";
// Switch: true = SO_AUTO_GD sends the deliveries the GD form's V2 rules accept to GD Created V2; false = all classic
const CONVERT_CREATED_V2 = true;
const GD_ASYNC_WORKER_ID = "2104840667119411201";

// Org-scoped like GDheadWorkflow: a plant-scoped read is empty for plants with no row of
// their own, which would read as "no picking setup".
const checkPickingSetup = async (organizationID) => {
  try {
    const resPickingSetup = await db
      .collection("picking_setup")
      .where({ organization_id: organizationID })
      .get();

    return resPickingSetup;
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
};

const escapeHTML = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const handleConvertGDDraft = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
) => {
  this.showLoading("Converting...");
  await this.runWorkflow(
    CONVERT_GD_DRAFT_WORKFLOW_ID,
    {
      gd_type: convertType,
      so_ids: selectedRecords.map((record) => record.id),
      plant_id: plantID,
      organization_id: organizationID,
    },
    async (res) => {
      console.log("Mapped GD Data", res.data);
      const mappedData = res.data.data;

      if (convertType === "single") {
        this.hideLoading();
        await this.toView({
          target: "1902054888473481218",
          type: "add",
          data: {
            ...mappedData[0],
          },
          params: {
            allItems: mappedData[0].all_item,
          },
          position: "rtl",
          mode: "dialog",
          width: "80%",
          title: "Add",
        });
      } else if (convertType === "multiple") {
        this.hideLoading();
        await this.refresh();
        await this.$alert(
          `Successfully created ${
            mappedData.length
          } draft goods deliveries.<br><br>
    <strong>Goods Delivery Numbers:</strong><br> ${mappedData
      .map((item) => item.delivery_no)
      .join("<br>")}`,
          "Success Converted to Goods Deliveries",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "success",
          },
        );
      }
    },
    async (err) => {
      this.hideLoading();
      this.$alert(err, "Error", {
        confirmButtonText: "OK",
        type: "error",
        dangerouslyUseHTMLString: true,
      });
    },
  );
};

// GD Created V2 writes a short line as "auto allocation: Insufficient stock for item X. Available: A, Requested: R" in the
// item's base unit; the list shows it like the GD form's Insufficient Inventory Alert, in the line's unit.
const SHORT_STOCK_MESSAGE =
  /Insufficient stock for item .*\. Available: (-?[0-9][0-9.eE+-]*), Requested: (-?[0-9][0-9.eE+-]*)/;
const SHORT_STOCK_COLUMNS = [
  "Item Code",
  "Item Name",
  "UOM",
  "Order Qty",
  "Undelivered",
  "Remaining Demand",
  "Available",
  "Shortfall",
];
const CELL_STYLE = "border:1px solid #ebeef5;padding:4px 6px;white-space:nowrap";
const RESULT_CLASS = "so-convert-gd-result";

const formatQty = (value) => String(Number((Number(value) || 0).toFixed(8)));

// A refused line as a short line in its own unit, or null when its message or quantities cannot be read
const shortLine = (line) => {
  const match =
    line.code === "GD_INSUFFICIENT_STOCK"
      ? SHORT_STOCK_MESSAGE.exec(line.message || "")
      : null;
  if (!match) return null;
  const availableBase = Number(match[1]);
  const toDeliver = Number(line.delivery_qty);
  const baseQty =
    Number(line.base_qty) > 0 ? Number(line.base_qty) : Number(match[2]);
  if (!isFinite(availableBase) || !(toDeliver > 0) || !(baseQty > 0)) return null;
  const available = Math.max(0, (availableBase * toDeliver) / baseQty);
  return { ...line, available, shortfall: Math.max(0, toDeliver - available) };
};

const shortTable = (rows) =>
  `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;margin:4px 0 8px;font-size:12px"><tr>${SHORT_STOCK_COLUMNS.map(
    (label) =>
      `<th style="${CELL_STYLE};background:#f5f7fa;text-align:left">${label}</th>`,
  ).join("")}</tr>${rows
    .map(
      (row) =>
        `<tr>${[row.item_code, row.item_name, row.uom]
          .map((value) => `<td style="${CELL_STYLE}">${escapeHTML(value)}</td>`)
          .join("")}${[
          row.order_qty,
          row.undelivered_qty,
          row.delivery_qty,
          row.available,
        ]
          .map(
            (value) =>
              `<td style="${CELL_STYLE};text-align:right">${formatQty(value)}</td>`,
          )
          .join(
            "",
          )}<td style="${CELL_STYLE};text-align:right;color:#f56c6c;font-weight:600">${formatQty(
          row.shortfall,
        )}</td></tr>`,
    )
    .join("")}</table></div>`;

// A sales order the save refused line by line: its short lines as a table, any other line listed. Null when the check
// sent no lines (a refusal of the whole delivery, or a check from before the lines were sent): the reason shows as before.
const refusedDetail = (item) => {
  const lines = (item.lines || []).filter(
    (line) => String(line.line_no ?? "") !== "",
  );
  if (lines.length === 0) return null;
  const total = Math.max(Number(item.lineCount) || 0, lines.length);
  const rows = [];
  const others = [];
  for (const line of lines) {
    const row = shortLine(line);
    if (row) {
      rows.push(row);
    } else {
      others.push(
        `Line ${escapeHTML(line.line_no)}${
          line.item_code ? ` (${escapeHTML(line.item_code)})` : ""
        }: ${escapeHTML(line.message || line.code)}`,
      );
    }
  }
  const title =
    others.length === 0
      ? `not enough stock for ${total} item${total === 1 ? "" : "s"}`
      : `${total} line${total === 1 ? " needs" : "s need"} correcting`;
  return {
    hasTable: rows.length > 0,
    html: `<strong>${escapeHTML(item.so_no)}</strong> — ${title}${
      rows.length > 0 ? shortTable(rows) : "<br>"
    }${others.join("<br>")}${
      total > lines.length ? `<br>… and ${total - lines.length} more` : ""
    }`,
  };
};

const SHORT_STOCK_NOTE = `<span style="color:#909399">Convert one of these on its own to open the form, where you can deliver the available quantity.</span>`;

const hasShortTable = (blocked) =>
  blocked.some((item) => {
    const detail = refusedDetail(item);
    return detail !== null && detail.hasTable;
  });

// A table needs more room than the message box gives: the result opens wider, its style added to the page once
const resultOptions = (blocked, options) => {
  if (!hasShortTable(blocked)) return options;
  try {
    if (!document.getElementById(`${RESULT_CLASS}-style`)) {
      const style = document.createElement("style");
      style.id = `${RESULT_CLASS}-style`;
      style.textContent = `.el-message-box.${RESULT_CLASS}{--el-messagebox-width:min(960px,95vw);width:min(960px,95vw);max-width:95vw}.el-message-box.${RESULT_CLASS} .el-message-box__message{max-height:65vh;overflow:auto}`;
      document.head.appendChild(style);
    }
  } catch (error) {
    console.error("The result window could not be widened:", error);
  }
  return { ...options, customClass: RESULT_CLASS };
};

const buildCreatedSummary = (created, blocked, pending = []) => {
  const sections = [];

  if (created.length > 0) {
    sections.push(
      `<strong>Created ${created.length} goods deliver${
        created.length === 1 ? "y" : "ies"
      }:</strong><br>${created
        .map(
          (item) =>
            `${escapeHTML(item.delivery_no)} <span style="color:#909399">(${escapeHTML(
              item.so_no,
            )})</span>`,
        )
        .join("<br>")}`,
    );
  }

  if (pending.length > 0) {
    sections.push(
      `<strong>Being created in the background (${pending.length}):</strong><br>${pending
        .map((item) => escapeHTML(item.so_no))
        .join("<br>")}<br>They appear in the Goods Delivery list when done.`,
    );
  }

  if (blocked.length > 0) {
    // one block per sales order: a table or a list of lines keeps the same gap to the next one as a one-line reason
    sections.push(
      `<strong>Not converted (${blocked.length}):</strong>${blocked
        .map((item) => {
          const detail = refusedDetail(item);
          return `<div style="margin-top:6px">${
            detail
              ? detail.html
              : `${escapeHTML(item.so_no)} — ${escapeHTML(item.reason)}`
          }</div>`;
        })
        .join("")}${
        hasShortTable(blocked)
          ? `<div style="margin-top:6px">${SHORT_STOCK_NOTE}</div>`
          : ""
      }`,
    );
  }

  return sections.join("<br><br>");
};

// GD_SO_CONVERT_CHECK (read-only): the selected sales orders that still have a delivery saving in the background (an
// unfinished GD Created V2 save). A check that cannot run answers none: GD_ASYNC_SUBMIT still refuses such a save.
const SO_CONVERT_CHECK_WORKFLOW_ID = "2112084100104495105";

const checkSavingInBackground = (records) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        SO_CONVERT_CHECK_WORKFLOW_ID,
        { so_ids: records.map((record) => String(record.id)) },
        (res) => {
          let busy = [];
          try {
            busy = JSON.parse((res && res.data && res.data.busy_json) || "[]");
          } catch (error) {
            busy = [];
          }
          resolve(Array.isArray(busy) ? busy : []);
        },
        (err) => {
          console.error("Convert check failed:", err);
          resolve([]);
        },
      );
    } catch (error) {
      console.error("Convert check could not run:", error);
      resolve([]);
    }
  });

// A few sales orders per call: one call for 250 ran 54 minutes, and a single failing
// sales order ended the whole batch.
const CONVERT_BATCH_SIZE = 5;

const runConvertBatch = (soIds, plantID, organizationID, convertType) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        CONVERT_GD_CREATED_WORKFLOW_ID,
        {
          so_ids: soIds,
          gd_type: convertType,
          plant_id: plantID,
          organization_id: organizationID,
          created_by: this.getVarGlobal("nickname"),
          v2: CONVERT_CREATED_V2 ? "1" : "",
        },
        (res) => resolve({ ok: true, result: res?.data || {} }),
        (err) => resolve({ ok: false, error: err }),
      );
    } catch (error) {
      resolve({ ok: false, error });
    }
  });

// GD Created V2: the list follows the queued deliveries for at most this long, then reports the rest as in the background
const FOLLOW_MS = 120000;
const FOLLOW_EVERY_MS = 3000;
const CREATED_STATES = ["GD_COMMITTED", "CREATING_PICKING", "PICKING_RETRYING", "PICKING_READY", "COMPLETED"];

const kickWorker = (jobId) => {
  try {
    this.runWorkflow(
      GD_ASYNC_WORKER_ID,
      { job_id: jobId },
      () => {},
      (err) => console.error("GD V2 worker for job " + jobId + ":", err),
    );
  } catch (error) {
    console.error("GD V2 worker could not be started:", error);
  }
};

// A FAILED job's refused lines (job_lines_json: the first 10 per job, with item, unit and quantities) and how many it has
const attachRefusedLines = (jobs, data) => {
  let lines = [];
  try {
    lines = JSON.parse((data && data.job_lines_json) || "[]");
  } catch (error) {
    lines = [];
  }
  for (const job of jobs) {
    job.lines = (Array.isArray(lines) ? lines : []).filter(
      (line) => line && String(line.job_id) === String(job.job_id),
    );
    try {
      job.lineCount =
        Number(JSON.parse(job.error_details || "{}").line_error_count) || 0;
    } catch (error) {
      job.lineCount = 0;
    }
  }
};

const readJobs = (jobIds) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        SO_CONVERT_CHECK_WORKFLOW_ID,
        { job_ids: jobIds, job_lines: "1" },
        (res) => {
          let jobs = null;
          try {
            jobs = JSON.parse((res && res.data && res.data.jobs_json) || "[]");
          } catch (error) {
            jobs = null;
          }
          if (Array.isArray(jobs)) attachRefusedLines(jobs, res && res.data);
          resolve(Array.isArray(jobs) ? jobs : null);
        },
        (err) => {
          console.error("Job check failed:", err);
          resolve(null);
        },
      );
    } catch (error) {
      console.error("Job check could not run:", error);
      resolve(null);
    }
  });

// Starts the worker for each queued delivery, then moves each one to created / blocked as its job ends; returns the rest
const followBackground = async (queued, created, blocked) => {
  let pending = queued.slice();
  pending.forEach((item) => kickWorker(item.job_id));
  const started = Date.now();
  let round = 0;
  while (pending.length > 0 && Date.now() - started < FOLLOW_MS) {
    this.hideLoading();
    this.showLoading(
      `Creating goods deliveries in the background: ${queued.length - pending.length} of ${queued.length} done...`,
    );
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_EVERY_MS));
    const jobs = await readJobs(pending.map((item) => item.job_id));
    if (!jobs) continue;
    const byId = {};
    jobs.forEach((job) => {
      byId[String(job.job_id)] = job;
    });
    const still = [];
    for (const item of pending) {
      const job = byId[String(item.job_id)];
      const status = job ? job.job_status : "";
      if (CREATED_STATES.indexOf(status) >= 0) {
        created.push({ so_no: item.so_no, delivery_no: job.gd_no || item.gd_no || "" });
      } else if (status === "FAILED" || status === "CANCELLED") {
        blocked.push({
          so_no: item.so_no,
          reason: job.error_message || "The goods delivery could not be created.",
          lines: job.lines || [],
          lineCount: job.lineCount || 0,
        });
      } else if (status === "REQUIRES_REVIEW") {
        blocked.push({
          so_no: item.so_no,
          reason: `Held for review by an administrator${job.error_message ? ": " + job.error_message : "."} Do not convert it again.`,
        });
      } else if (status === "AWAITING_CONFIRMATION") {
        blocked.push({
          so_no: item.so_no,
          reason: "Conditions changed while it was being saved and a confirmation is needed. Convert it through the Convert form.",
        });
      } else {
        still.push(item);
      }
    }
    pending = still;
    // a worker run that ended before its job did (stock locks held by another save) is started again
    if (++round % 5 === 0) pending.forEach((item) => kickWorker(item.job_id));
  }
  return pending;
};

// A batch whose answer was lost (its call outlived the request: 90 s seen on prod) is looked up in the record of its
// SO_AUTO_GD run, which appears when the run ends; the list waits at most this long for it
const RECOVER_MS = 300000;
const RECOVER_EVERY_MS = 5000;

const readConvertRun = (soIds, sinceSeconds) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        SO_CONVERT_CHECK_WORKFLOW_ID,
        { run_so_ids: soIds, run_since_s: String(sinceSeconds) },
        (res) => {
          let run = null;
          try {
            run = JSON.parse((res && res.data && res.data.run_json) || "null");
          } catch (error) {
            run = null;
          }
          resolve({ run: run && typeof run === "object" ? run : null });
        },
        (err) => {
          console.error("Convert run check failed:", err);
          resolve({ checkFailed: true });
        },
      );
    } catch (error) {
      console.error("Convert run check could not run:", error);
      resolve({ checkFailed: true });
    }
  });

// Answers like runConvertBatch: the run's own answer once it has ended; failed when the run itself failed
const recoverConvertBatch = async (batch, sentAt) => {
  const soIds = batch.map((record) => String(record.id));
  const until = Date.now() + RECOVER_MS;
  let checkFailures = 0;
  while (Date.now() < until && checkFailures < 3) {
    const waited = Math.round((Date.now() - sentAt) / 1000);
    this.hideLoading();
    this.showLoading(`Converting to Goods Delivery: the server is still working (${waited} s)...`);
    const read = await readConvertRun(soIds, Math.min(3600, waited + 10));
    checkFailures = read.checkFailed ? checkFailures + 1 : 0;
    const run = read.run;
    if (run && run.status === "Complete" && run.result) return { ok: true, result: run.result };
    if (run && run.status) return { ok: false, failed: true, error: run.error || "" };
    await new Promise((resolve) => setTimeout(resolve, RECOVER_EVERY_MS));
  }
  return { ok: false };
};

const handleConvertGDCreated = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
) => {
  // A second click while a batch is still running would convert the same sales orders again.
  if (window.__soConvertGdBusy) {
    await this.$alert(
      "A conversion to Goods Delivery is still running. Wait for it to finish.",
      "Conversion Running",
      { confirmButtonText: "OK", type: "warning" },
    );
    return;
  }
  window.__soConvertGdBusy = true;

  const total = selectedRecords.length;
  const created = [];
  const blocked = [];
  const queued = [];
  let pending = [];
  let setupMessage = "";

  try {
    for (let start = 0; start < total; start += CONVERT_BATCH_SIZE) {
      const batch = selectedRecords.slice(start, start + CONVERT_BATCH_SIZE);
      this.hideLoading();
      this.showLoading(
        total > CONVERT_BATCH_SIZE
          ? `Converting to Goods Delivery: ${start} of ${total} sales orders done...`
          : "Converting to Goods Delivery...",
      );

      const sentAt = Date.now();
      let reply = await runConvertBatch(
        batch.map((record) => record.id),
        plantID,
        organizationID,
        convertType,
      );
      // A lost answer (the call outlived the request): the server's record of the batch's run tells what it did.
      if (!reply.ok) reply = await recoverConvertBatch(batch, sentAt);

      if (!reply.ok) {
        // The server may still have converted some of these; converting again reports
        // those as having nothing left to deliver.
        for (const record of batch) {
          blocked.push({
            so_no: record.so_no || record.id,
            reason: reply.failed
              ? `The conversion stopped with an error on the server${reply.error ? ": " + reply.error : ""}. Check whether it already has a goods delivery before converting it again.`
              : "No answer from the server. Check whether it already has a goods delivery before converting it again.",
          });
        }
        continue;
      }

      const result = reply.result;
      const batchCreated = result.created || [];
      const batchBlocked = result.blocked || [];
      const batchQueued = result.queued || [];
      created.push(...batchCreated);
      blocked.push(...batchBlocked);
      queued.push(...batchQueued);

      // A setup gate (picking setup, picking mode) refuses every batch alike: stop at the first.
      if (
        batchCreated.length === 0 &&
        batchBlocked.length === 0 &&
        batchQueued.length === 0 &&
        String(result.code) !== "200"
      ) {
        setupMessage = result.message || "";
        break;
      }
    }

    if (queued.length > 0) {
      pending = await followBackground(queued, created, blocked);
    }
  } finally {
    this.hideLoading();
    window.__soConvertGdBusy = false;
  }

  // Per-SO reasons first: the server message carries real text only when a setup gate fired.
  if (created.length === 0 && pending.length === 0) {
    await this.$alert(
      blocked.length > 0
        ? blocked
            .map((item) => {
              const detail = refusedDetail(item);
              return `<div style="margin-bottom:10px">${
                detail
                  ? detail.html
                  : `<strong>${escapeHTML(item.so_no)}</strong><br>${escapeHTML(
                      item.reason,
                    )}`
              }</div>`;
            })
            .join("") +
            (hasShortTable(blocked) ? `<div>${SHORT_STOCK_NOTE}</div>` : "")
        : setupMessage || "No goods deliveries were created.",
      "Could Not Convert to Goods Delivery",
      resultOptions(blocked, {
        confirmButtonText: "OK",
        type: "error",
        dangerouslyUseHTMLString: true,
      }),
    );
    return;
  }

  await this.refresh();
  await this.$alert(
    buildCreatedSummary(created, blocked, pending),
    blocked.length > 0
      ? "Converted with Exceptions"
      : "Converted to Goods Deliveries",
    resultOptions(blocked, {
      confirmButtonText: "OK",
      type: blocked.length > 0 ? "warning" : "success",
      dangerouslyUseHTMLString: true,
    }),
  );
};

const handleConvertGD = async (
  selectedRecords,
  plantID,
  organizationID,
  convertType,
  convertAsCreated,
) => {
  try {
    // One GD means the user gets to look at it: a single document (one SO, or several merged)
    // always opens the form, whatever convert_gd_created says. Only a batch of one-GD-per-SO
    // is worth saving headlessly.
    if (convertAsCreated && convertType === "multiple") {
      await handleConvertGDCreated(
        selectedRecords,
        plantID,
        organizationID,
        convertType,
      );
      return;
    }

    await handleConvertGDDraft(
      selectedRecords,
      plantID,
      organizationID,
      convertType,
    );
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
};

(async () => {
  try {
    let selectedRecords = arguments[0].selectedRecords;
    const plantID = arguments[0].plantID;
    const organizationID = arguments[0].organizationID;

    console.log("handleConvertGD selectedRecords:", selectedRecords);

    const resPickingSetup = await checkPickingSetup(organizationID);

    // return if picking setup is not found or SO -> Picking -> GD
    if (!resPickingSetup || resPickingSetup.data.length === 0) {
      await this.$alert(
        "Cannot convert to Goods Delivery. Please check your picking setup.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        },
      );

      throw new Error(
        "Cannot convert to Goods Delivery. Please check your picking setup.",
      );
    }

    const pickingSetup = resPickingSetup.data[0];

    if (
      pickingSetup.picking_required === 1 &&
      pickingSetup.picking_after === "Sales Order"
    ) {
      await this.$alert(
        "Cannot convert to Goods Delivery after Sales Order. Please check your picking setup.",
        "Error",
        {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        },
      );
      throw new Error(
        "Cannot convert to Goods Delivery after Sales Order. Please check your picking setup.",
      );
    }

    const convertAsCreated = Number(pickingSetup.convert_gd_created) === 1;

    // A sales order whose delivery is still saving in the background is not converted again: its remaining quantity only
    // drops once that save finishes, so a second delivery now would deliver it twice
    const saving = await checkSavingInBackground(selectedRecords);
    if (saving.length > 0) {
      const savingIds = new Set(saving.map((item) => String(item.so_id)));
      const savingNos = selectedRecords
        .filter((record) => savingIds.has(String(record.id)))
        .map((record) => escapeHTML(record.so_no || record.id));
      const rest = selectedRecords.filter((record) => !savingIds.has(String(record.id)));
      const intro = `${
        savingNos.length === 1 ? "This sales order has" : "These sales orders have"
      } a goods delivery that is still being saved in the background. Wait until it appears in the Goods Delivery list, then convert again:<br><br>${savingNos.join("<br>")}`;
      if (rest.length === 0) {
        await this.$alert(intro, "Delivery Still Saving", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });
        return;
      }
      try {
        await this.$confirm(
          `${intro}<br><br>Convert the other ${rest.length} sales order${rest.length === 1 ? "" : "s"}?`,
          "Delivery Still Saving",
          {
            confirmButtonText: "Convert the others",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          },
        );
      } catch (error) {
        return;
      }
      selectedRecords = rest;
    }

    if (selectedRecords.length > 1) {
      await this.$confirm(
        `Would you like to convert these into a single goods delivery or into multiple goods deliveries?<br><br>
          <strong>Single GD:</strong> All items combined into one document, opened for review<br>
          <strong>Multiple GDs:</strong> Separate deliveries for better tracking${
            convertAsCreated
              ? `<br><br>Multiple GDs will be saved as <strong>Created</strong> with stock allocated, without opening the form. Any sales order that cannot be covered is reported and left unconverted.`
              : ""
          }`,
        "Sales Order Conversion",
        {
          confirmButtonText: "Single GD",
          cancelButtonText: "Multiple GDs",
          dangerouslyUseHTMLString: true,
          type: "info",
          distinguishCancelAndClose: true,

          beforeClose: async (action, instance, done) => {
            // handle single GD
            if (action === "confirm") {
              const uniqueCustomers = new Set(
                selectedRecords.map((record) => record.customer_name.id),
              );

              const allSameCustomer = uniqueCustomers.size === 1;

              if (!allSameCustomer) {
                await this.$confirm(
                  `Selected SOs contain multiple customers. Create individual goods deliveries - one GD per SO?`,
                  "Multiple Customers Detected",
                  {
                    confirmButtonText: "Proceed",
                    cancelButtonText: "Cancel",
                    dangerouslyUseHTMLString: true,
                    type: "info",
                  },
                ).catch(() => {
                  console.log("User clicked Cancel or closed the dialog");
                  throw new Error();
                });

                await handleConvertGD(
                  selectedRecords,
                  plantID,
                  organizationID,
                  "multiple",
                  convertAsCreated,
                );
                return;
              } else {
                await handleConvertGD(
                  selectedRecords,
                  plantID,
                  organizationID,
                  "single",
                  convertAsCreated,
                );
              }
              done();
            } else if (action === "cancel") {
              // handle multiple GD
              await handleConvertGD(
                selectedRecords,
                plantID,
                organizationID,
                "multiple",
                convertAsCreated,
              );
              done();
            } else {
              done();
            }
          },
        },
      );
    } else {
      await handleConvertGD(
        selectedRecords,
        plantID,
        organizationID,
        "single",
        convertAsCreated,
      );
    }
  } catch (error) {
    console.error("Error in convert GD:", error);
  }
})();
