// Picking V2 1c: PICKING_ASYNC_SUBMIT's guard (code/submit_guard.js) and decide (code/submit_decide.js) node bodies, run as
// the platform runs them (placeholders = JSON text). sql_node_PSfacts / sql_node_PSmove rows are given.
const fs = require("fs");
const path = require("path");
const { runBody, eq, done } = require("../../gdc/pkv2tools/harness.js");
const read = (f) => fs.readFileSync(process.env[f === "submit_decide.js" ? "DECIDE_JS" : "GUARD_JS"] || path.join(__dirname, "..", "code", f), "utf8");
const GUARD = read("submit_guard.js");
const DECIDE = read("submit_decide.js");
// shipped ON since the 2026-10-16 live tests (batch f); OFF = the switch-off state a release could fall back to
const ON = DECIDE;
const OFF = DECIDE.replace("LOADING_BAY: true, BIN_MOVES: true", "LOADING_BAY: false, BIN_MOVES: false");
if (OFF === DECIDE) throw new Error("the stage switches are not in the shipped (on) form");

const guard = (payload, op) => runBody(GUARD, {
  "workflowparams:picking_id": "9001", "workflowparams:organization_id": "1901545950162329602", "workflowparams:operation": op || "CONFIRM",
  "workflowparams:idempotency_key": "PK-9001-abcdefghijklmnop", "workflowparams:payload": JSON.stringify(payload), "workflowparams:confirmed_by": "tester",
  "system:tenantId": "496474" }, "guard");

// guard: the targets each picked line sends, for sql_node_PSmove
{
  const g = guard({ lines: [{ row_id: "11", qty: 2, target_location_id: "501", target_batch_id: "" }, { row_id: "12", qty: 1 }, { row_id: "13", qty: 0, target_location_id: "502" }] });
  eq("guard: CONTINUE", g.route, "CONTINUE");
  eq("guard: moveRowsJson sent / sent empty / not sent; a zero line is not a picked line", JSON.parse(g.moveRowsJson),
    [{ r: "11", l: "501", b: "0" }, { r: "12", l: null, b: null }]);
  const all = guard({}, "PICK_ALL_REMAINING");
  eq("guard: PICK_ALL_REMAINING reads the stored targets", [all.route, all.moveRowsJson], ["CONTINUE", "[]"]);
  eq("guard: a target that is not an id is refused", guard({ lines: [{ row_id: "11", qty: 1, target_location_id: "5'01" }] }).route, "REJECT");
  eq("guard: moveRowsJson holds digits, quotes, brackets, commas, colons and null only",
    /^[\[\]{}",:a-z0-9]*$/.test(guard({ lines: [{ row_id: "11", qty: 1, target_location_id: "501" }] }).moveRowsJson), true);
}

const G = { route: "CONTINUE", tenantId: "496474", pickingId: "9001", organizationId: "1901545950162329602", operation: "CONFIRM", idempotencyKey: "PK-9001-abcdefghijklmnop", request: "{}", lineCount: 1 };
const FACTS = { db_now: "2026-10-16 12:00:00", id: "9001", to_id: "PI-1", to_status: "Created", is_deleted: 0, organization_id: "1901545950162329602", plant_id: "1942795438353035266",
  is_processing: 0, is_loading_bay: 0, lock_age_sec: 99999, picking_after: "Goods Delivery", allow_full_picking: "0", auto_completed_gd: "0", setup_loading_bay: "0", key_job: null,
  open_job: null, moved_rows: 0, gd_busy: null };
const R = (o) => Object.assign({ kind: "R", row_id: "11", gd_id: "5001", moved: 1, bay_bad: 0, hu: null, label: "Item A" }, o);
const GD = (o) => Object.assign({ kind: "G", gd_id: "5001", delivery_no: "GD/1", line_count: "3", serial_items: "0", select_picking: "0", linked: "0", other_job: "0" }, o);
const decide = (code, facts, move, g) => runBody(code, { "node:code_node_PSguard.data": Object.assign({}, G, g || {}), "node:sql_node_PSfacts.data": [Object.assign({}, FACTS, facts || {})],
  "node:sql_node_PSmove.data": move || [] }, "decide");
const route = (r) => [r.route, r.result_message];

// switches as shipped (off): every move and Loading Bay goes to the classic save, as before
eq("off: a bay org", route(decide(OFF, { setup_loading_bay: "1" }, [R({ bay_bad: 0 })])), ["NOT_ELIGIBLE", "Loading Bay uses the classic save"]);
eq("off: the Picking's own bay flag", route(decide(OFF, { is_loading_bay: 1 })), ["NOT_ELIGIBLE", "Loading Bay uses the classic save"]);
eq("off: a CONFIRM that moves a line", route(decide(OFF, {}, [R(), GD()])), ["NOT_ELIGIBLE", "1 line(s) move stock to another bin or batch: the classic save"]);
eq("off: no move", decide(OFF, {}, []).route, "CREATE");

// switches on
eq("on: bay + Auto Complete GD", route(decide(ON, { setup_loading_bay: "1", auto_completed_gd: "1" }, [R()])),
  ["REJECT", "Picking Setup has both Loading Bay and Auto Complete GD enabled. Auto Complete GD skips the Created state that the loading bay move depends on, which would strand the reserved stock at the source bin. Please turn off Auto Complete GD."]);
eq("on: bay, a picked line without a bay bin", route(decide(ON, { setup_loading_bay: "1" }, [R({ moved: 0, bay_bad: 1, label: "Item B" }), R({ row_id: "12", label: "Item A" }), GD()])),
  ["REJECT", "Loading Bay is enabled but Target Location is missing (or the same as the source bin) on these picked items: Item B. Set a loading bay bin on every picked line before completing."]);
eq("on: bay, every line to a bay bin", decide(ON, { setup_loading_bay: "1" }, [R(), GD()]).route, "CREATE");
eq("on: the Picking's own bay flag alone is not Loading Bay (classic reads the setup)", decide(ON, { is_loading_bay: 1 }, []).route, "CREATE");
eq("on: a swap", decide(ON, {}, [R(), GD()]).route, "CREATE");
eq("on: PICK_ALL_REMAINING with stored moves", decide(ON, {}, [R(), GD()], { operation: "PICK_ALL_REMAINING" }).route, "CREATE");
eq("on: Full Picking + a move", route(decide(ON, { allow_full_picking: "1" }, [R(), GD()])), ["NOT_ELIGIBLE", "Full Picking with a bin / batch move uses the classic save"]);
eq("on: Full Picking without a move", decide(ON, { allow_full_picking: "1" }, []).route, "CREATE");
eq("on: a moved line in a handling unit", route(decide(ON, {}, [R({ hu: "777" }), GD()])), ["NOT_ELIGIBLE", "a moved line is in a handling unit: the classic save"]);
eq("on: serial items on a moved GD", route(decide(ON, {}, [R(), GD({ serial_items: "2" })])), ["NOT_ELIGIBLE", "Goods Delivery GD/1 has serial-numbered items: the classic save"]);
eq("on: select picking", route(decide(ON, {}, [R(), GD({ select_picking: "1" })])), ["NOT_ELIGIBLE", "Goods Delivery GD/1 uses select picking: the classic save"]);
eq("on: internal-trading linkage", route(decide(ON, {}, [R(), GD({ linked: "1" })])), ["NOT_ELIGIBLE", "Goods Delivery GD/1 is linked to internal trading: the classic save"]);
eq("on: 26 moved deliveries", route(decide(ON, {}, [R()].concat(Array.from({ length: 26 }, (_, i) => GD({ gd_id: String(5001 + i), delivery_no: "GD/" + i }))))),
  ["REJECT", "This confirmation moves stock on 26 deliveries; at most 25 can be saved together. Confirm it in smaller Pickings."]);
eq("on: 501 moved-GD lines (classic's 500)", route(decide(ON, {}, [R(), GD({ line_count: "300" }), GD({ gd_id: "5002", delivery_no: "GD/2", line_count: "201" })])),
  ["REJECT", "Moving picked stock to another bin or batch is not available yet above 500 delivery lines in one confirmation (these deliveries have 501). Nothing was saved."]);
eq("on: 500 moved-GD lines", decide(ON, {}, [R(), GD({ line_count: "300" }), GD({ gd_id: "5002", delivery_no: "GD/2", line_count: "200" })]).route, "CREATE");
eq("on: a moved GD confirmed on another Picking", route(decide(ON, {}, [R(), GD({ other_job: "1" })])),
  ["REJECT", "Goods Delivery GD/1 is being confirmed on another Picking in the background. Wait a moment, then try again."]);

// unchanged routes
eq("key already used", decide(ON, { key_job: "77|QUEUED" }, [R()]).route, "RETURN");
eq("GD busy", route(decide(ON, { gd_busy: "GD/9" }, [R()])), ["REJECT", "Goods Delivery GD/9 is being saved in the background. Wait a moment, then try again."]);
eq("Draft", decide(ON, { to_status: "Draft" }, []).route, "NOT_ELIGIBLE");
eq("open job", decide(ON, { open_job: "70|QUEUED" }, []).route, "REJECT");
eq("Picking Plan", route(decide(ON, { picking_after: "Sales Order" }, [])), ["NOT_ELIGIBLE", "Picking Plan pickings use the classic save"]);
eq("Auto Complete GD (not bay)", route(decide(ON, { auto_completed_gd: "1" }, [])), ["NOT_ELIGIBLE", "Auto Complete GD uses the classic save"]);
eq("CREATE carries the job row", decide(ON, {}, []).jobRows.map((j) => [j.command, j.job_status, j.picking_id]), [["CONFIRM_PICKING", "QUEUED", "9001"]]);

// the job's request records whether the switches cleared its moves: PREPARE refuses a move (one that appears after SUBMIT) on a job they did not
const BAY_ONLY = OFF.replace("LOADING_BAY: false", "LOADING_BAY: true");
const REQ = JSON.stringify({ v: 1, operation: "CONFIRM", picking_id: "9001", lines: [{ row_id: "11", qty: 1 }] });
const stamp = (code, facts) => JSON.parse(decide(code, facts, [], { request: REQ }).jobRows[0].request_payload);
eq("stamp: switches off -> moves 0, the request kept", stamp(OFF, {}), Object.assign(JSON.parse(REQ), { moves: 0 }));
eq("stamp: switches on, not bay -> moves 1", [stamp(ON, {}).moves], [1]);
eq("stamp: switches on, bay -> moves 1", [stamp(ON, { setup_loading_bay: "1" }).moves], [1]);
eq("stamp: only LOADING_BAY on, not bay -> moves 0", [stamp(BAY_ONLY, {}).moves], [0]);
eq("stamp: only LOADING_BAY on, bay -> moves 1", [stamp(BAY_ONLY, { setup_loading_bay: "1" }).moves], [1]);
done();
