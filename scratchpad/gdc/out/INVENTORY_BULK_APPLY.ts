import {
  apiFlow,
  code,
  sql,
  switchFirst,
  rule,
  any,
  expression,
  add,
  update,
  setCache,
  getCache,
  callWorkflow,
  parallel,
} from '@su-code/workflow-dsl';
import { t, workflows } from '../../../.su-code/types';

export default apiFlow(
  'INVENTORY_BULK_APPLY',
  {
    request: {
      operation_key: {
        type: 'string',
        key: 'iba0opky',
        title: 'operation_key',
        description: 'caller-unique, 1-32 of A-Z a-z 0-9 | : . _ - (e.g. GDC|<job id>); a repeat returns the stored answer',
        isExpand: false,
      },
      mode: { type: 'string', key: 'iba0mode', title: 'mode', description: 'PLAN (writes nothing) | APPLY', isExpand: false },
      organization_id: { type: 'string', key: 'iba0orgi', title: 'organization_id', description: '', isExpand: false },
      movements: {
        type: 'any',
        key: 'iba0movs',
        title: 'movements',
        description: 'ordered SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW parameter sets + direction (SUBTRACT|ADD) + movement_key [+ unit_price_from]',
        isExpand: false,
        children: [],
      },
    },
    response: {
      code: { type: 'string', key: 'iba1code', title: 'code', description: '200 / 400 / 409 lock busy / 500 review', isExpand: false },
      result_code: { type: 'string', key: 'iba1rcod', title: 'result_code', description: '', isExpand: false },
      message: { type: 'string', key: 'iba1mesg', title: 'message', description: '', isExpand: false },
      results: { type: 'any', key: 'iba1rslt', title: 'results', description: 'per movement: code, unit_price, total_price, dates', isExpand: false, children: [] },
      summary: { type: 'any', key: 'iba1summ', title: 'summary', description: '', isExpand: false, children: [] },
    },
  },
  async (wf) => {
    /* @id code_node_IBguard */ const code_node_IBguard = await code('Guard: request, session tenant, the lists every read binds', "// INVENTORY_BULK_APPLY guard: request, session tenant, run nonce, and every list the SQL nodes bind (digits only)\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v)).trim();\nconst DIG = /^[0-9]{1,20}$/;\nconst KEY = /^[A-Za-z0-9._-]{1,40}$/;\nconst MAX_MOVEMENTS = 5000;\n\nconst bulkGuard = function bulkGuard(inp) {\n  const reject = (code, message) => ({ route: \"REJECT\", result_code: code, result_message: message });\n  const mode = s(inp.mode).toUpperCase();\n  const op = s(inp.operationKey);\n  const org = s(inp.organizationId);\n  const tenant = s(inp.tenantId);\n  if (mode !== \"PLAN\" && mode !== \"APPLY\") return reject(\"REQUEST_INVALID\", \"mode must be PLAN or APPLY\");\n  if (!/^[A-Za-z0-9|:._-]{1,32}$/.test(op)) return reject(\"REQUEST_INVALID\", \"operation_key must be 1-32 of A-Z a-z 0-9 | : . _ -\");\n  if (!DIG.test(org)) return reject(\"REQUEST_INVALID\", \"organization_id must be digits\");\n  if (!DIG.test(tenant)) return reject(\"REQUEST_INVALID\", \"no session tenant\");\n  let list = inp.movements;\n  if (typeof list === \"string\") {\n    try {\n      list = JSON.parse(list);\n    } catch (e) {\n      return reject(\"REQUEST_INVALID\", \"movements is not JSON\");\n    }\n  }\n  if (!Array.isArray(list) || !list.length) return reject(\"REQUEST_INVALID\", \"movements must be a non-empty array\");\n  if (list.length > MAX_MOVEMENTS) return reject(\"REQUEST_INVALID\", \"at most \" + MAX_MOVEMENTS + \" movements per operation\");\n\n  const seen = {};\n  const mats = {};\n  const balTuples = {};\n  const batchTuples = {};\n  const costPairs = {};\n  const lockKeys = {};\n  const effectKeys = [];\n  for (let i = 0; i < list.length; i++) {\n    const m = list[i] || {};\n    const at = \"movements[\" + i + \"] \";\n    const key = s(m.movement_key);\n    if (!KEY.test(key)) return reject(\"REQUEST_INVALID\", at + \"movement_key must be 1-40 of A-Z a-z 0-9 . _ -\");\n    if (seen[key]) return reject(\"REQUEST_INVALID\", at + \"movement_key \" + key + \" repeats\");\n    seen[key] = true;\n    const dir = s(m.direction);\n    if (dir !== \"SUBTRACT\" && dir !== \"ADD\") return reject(\"REQUEST_INVALID\", at + \"direction must be SUBTRACT or ADD\");\n    for (const f of [\"material_id\", \"plant_id\", \"location_id\"]) if (!DIG.test(s(m[f]))) return reject(\"REQUEST_INVALID\", at + f + \" must be digits\");\n    const batch = s(m.batch_id);\n    if (batch && !DIG.test(batch)) return reject(\"REQUEST_INVALID\", at + \"batch_id must be digits or empty\");\n    if (s(m.organization_id) !== org) return reject(\"REQUEST_INVALID\", at + \"organization_id differs from the operation's\");\n    if (dir === \"ADD\" && s(m.batch_number) && s(m.batch_number) !== \"-\" && !batch) return reject(\"UNSUPPORTED_NEW_BATCH\", at + \"creating a new batch is not supported yet\");\n    if (m.unit_price_from !== undefined && m.unit_price_from !== null && s(m.unit_price_from) !== \"\" && !seen[s(m.unit_price_from)]) {\n      return reject(\"REQUEST_INVALID\", at + \"unit_price_from must name an earlier movement\");\n    }\n    const mat = s(m.material_id);\n    const loc = s(m.location_id);\n    const plant = s(m.plant_id);\n    mats[mat] = true;\n    balTuples[\"[\" + mat + \",\" + loc + \",\" + plant + \"]\"] = true;\n    costPairs[\"[\" + mat + \",\" + plant + \"]\"] = true;\n    lockKeys[\"ITEM|\" + mat + \"|\" + loc] = true;\n    if (batch) {\n      batchTuples[\"[\" + mat + \",\" + loc + \",\" + batch + \",\" + plant + \"]\"] = true;\n      lockKeys[\"BATCH|\" + mat + \"|\" + loc + \"|\" + batch] = true;\n    }\n    effectKeys.push(op + \"|\" + key);\n  }\n  const keys = Object.keys(lockKeys).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));\n  // lists reach the SQL as ONE bound JSON string, unpacked by JSON_TABLE (ids stay exact: digits become JSON integers)\n  const jsonList = (o) => \"[\" + Object.keys(o).join(\",\") + \"]\";\n  return {\n    route: \"GO\",\n    result_code: \"\",\n    result_message: \"\",\n    mode: mode,\n    operationKey: op,\n    organizationId: org,\n    tenantId: tenant,\n    nonce: (s(inp.uuid).replace(/[^0-9a-fA-F]/g, \"\") + \"000000000000\").slice(0, 12),\n    count: list.length,\n    materialIdsCsv: Object.keys(mats).join(\",\") || \"0\",\n    balTuplesJson: jsonList(balTuples),\n    batchTuplesJson: jsonList(batchTuples),\n    costPairsJson: jsonList(costPairs),\n    effectKeysJson: JSON.stringify(effectKeys),\n    lockKeys: keys,\n    lockKeysJson: JSON.stringify(keys),\n  };\n};\n\nreturn bulkGuard({\n  mode: [{{workflowparams:mode}}][0],\n  operationKey: [{{workflowparams:operation_key}}][0],\n  organizationId: [{{workflowparams:organization_id}}][0],\n  movements: [{{workflowparams:movements}}][0],\n  tenantId: [{{system:tenantId}}][0],\n  uuid: [{{system:uuid}}][0],\n});\n", {
      outputs: {
        route: { type: 'string', title: 'route' },
        result_code: { type: 'string', title: 'result_code' },
        result_message: { type: 'string', title: 'result_message' },
        mode: { type: 'string', title: 'mode' },
        operationKey: { type: 'string', title: 'operationKey' },
        organizationId: { type: 'string', title: 'organizationId' },
        tenantId: { type: 'string', title: 'tenantId' },
        nonce: { type: 'string', title: 'nonce' },
        count: { type: 'int', title: 'count' },
        materialIdsCsv: { type: 'string', title: 'materialIdsCsv' },
        balTuplesJson: { type: 'string', title: 'balTuplesJson' },
        batchTuplesJson: { type: 'string', title: 'batchTuplesJson' },
        costPairsJson: { type: 'string', title: 'costPairsJson' },
        effectKeysJson: { type: 'string', title: 'effectKeysJson' },
        lockKeys: { type: 'array', title: 'lockKeys', items: 'any' },
        lockKeysJson: { type: 'string', title: 'lockKeysJson' },
      },
    });
    /* @id if_IBreject @title "IF the request is refused: answer 400, write nothing" */ if (
      rule({ field: code_node_IBguard.route, op: 'equal', value: 'REJECT' })
    ) {
      /* @id return_node_IBreject */ return {
        status: 200,
        code: '400',
        result_code: code_node_IBguard.result_code,
        message: code_node_IBguard.result_message,
      };
    }
    /* @id sql_node_IBops */ const sql_node_IBops = await sql("This operation's step rows (DONE / REVIEW / intent)", { table: t.GD_Publish_Step,
      sql:
        'SELECT p.step_name, p.step_status, p.result_ref, p.error_message,\n' +
        "       DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now\n" +
        '  FROM (SELECT NOW() AS t) n\n' +
        '  LEFT JOIN gd_publish_step p\n' +
        '    ON p.tenant_id = ?\n' +
        '   AND p.job_id = ?\n' +
        "   AND p.step_name LIKE 'IBA|%'\n" +
        '   AND p.is_deleted = 0',
      params: [code_node_IBguard.tenantId, code_node_IBguard.operationKey],
      outputs: {
        step_name: { type: 'string', title: 'step_name' },
        step_status: { type: 'string', title: 'step_status' },
        result_ref: { type: 'string', title: 'result_ref' },
        error_message: { type: 'string', title: 'error_message' },
        db_now: { type: 'string', title: 'db_now' },
      },
    });
    /* @id code_node_IBstate */ const code_node_IBstate = await code('State: replay a DONE answer, stop on REVIEW, resume a stored intent, or start', "// INVENTORY_BULK_APPLY state: DONE -> replay its stored answer; REVIEW -> stop; intent rows -> resume; else fresh\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst rows = [{{node:sql_node_IBops.data}}][0];\nconst list = Array.isArray(rows) ? rows : rows ? [rows] : [];\nconst mode = s([{{node:code_node_IBguard.data.mode}}][0]);\nlet done = null;\nlet review = null;\nconst intent = [];\nlet dbNow = \"\";\nfor (const r of list) {\n  if (!r) continue;\n  if (!dbNow && r.db_now) dbNow = s(r.db_now);\n  const name = s(r.step_name);\n  if (name === \"IBA|DONE\") done = r;\n  else if (name === \"IBA|REVIEW\") review = r;\n  else if (name.indexOf(\"IBA|I|\") === 0) intent.push(r);\n}\nintent.sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1));\nlet route = \"FRESH\";\nif (mode === \"PLAN\") route = \"PLAN\";\nelse if (done) route = \"REPLAY\";\nelse if (review) route = \"REVIEW\";\nelse if (intent.length) route = \"RESUME\";\nlet stored = {};\nif (done) {\n  try {\n    stored = JSON.parse(s(done.result_ref) || \"{}\");\n  } catch (e) {\n    stored = {};\n  }\n}\nreturn {\n  route: route,\n  dbNow: dbNow,\n  intentText: intent.map((r) => s(r.result_ref)).join(\"\"),\n  intentParts: String(intent.length),\n  storedResults: stored.results || [],\n  storedSummary: stored.summary || {},\n  reviewReason: review ? s(review.error_message) : \"\",\n};\n", {
      outputs: {
        route: { type: 'string', title: 'route' },
        dbNow: { type: 'string', title: 'dbNow' },
        intentText: { type: 'string', title: 'intentText' },
        intentParts: { type: 'string', title: 'intentParts' },
        storedResults: { type: 'array', title: 'storedResults', items: 'any' },
        storedSummary: { type: 'any', title: 'storedSummary' },
        reviewReason: { type: 'string', title: 'reviewReason' },
      },
    });
    /* @id if_IBreplay @title "IF this operation is DONE: return its stored answer, write nothing" */ if (
      rule({ field: code_node_IBstate.route, op: 'equal', value: 'REPLAY' })
    ) {
      /* @id return_node_IBreplay */ return {
        status: 200,
        code: '200',
        result_code: 'REPLAYED',
        message: 'Already applied',
        results: code_node_IBstate.storedResults,
        summary: code_node_IBstate.storedSummary,
      };
    }
    /* @id if_IBrev0 @title "IF this operation is under review: answer 500, write nothing" */ if (
      rule({ field: code_node_IBstate.route, op: 'equal', value: 'REVIEW' })
    ) {
      /* @id return_node_IBrev0 */ return {
        status: 200,
        code: '500',
        result_code: 'REQUIRES_REVIEW',
        message: code_node_IBstate.reviewReason,
      };
    }
    /* @id if_IBlock @title "IF APPLY: take the GD V2 balance locks (same keys and order as INVENTORY_APPLY_OPERATION)" */ if (
      rule({ field: code_node_IBstate.route, op: 'notEqual', value: 'PLAN' })
    ) {
      /* @id sql_node_IBlk1 */ const sql_node_IBlk1 = await sql('Lock seed: the lock rows of the keys', { table: t.Inventory_Balance_Lock,
        sql:
          'SELECT CAST(id AS CHAR) AS id, lock_key, balance_type, free_token, owner_operation_id, lock_version,\n' +
          "       last_owner_operation_id, is_deleted, DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now\n" +
          '  FROM inventory_balance_lock\n' +
          ' WHERE tenant_id = ?\n' +
          '   AND organization_id = ?\n' +
          '   AND lock_key IN (SELECT jt.k FROM JSON_TABLE(?, \'$[*]\' COLUMNS (k VARCHAR(128) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH \'$\')) jt)\n' +
          ' ORDER BY lock_key',
        params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.lockKeysJson],
        outputs: {
          id: { type: 'string', title: 'id' },
          lock_key: { type: 'string', title: 'lock_key' },
          balance_type: { type: 'string', title: 'balance_type' },
          free_token: { type: 'int', title: 'free_token' },
          owner_operation_id: { type: 'string', title: 'owner_operation_id' },
          lock_version: { type: 'int', title: 'lock_version' },
          last_owner_operation_id: { type: 'string', title: 'last_owner_operation_id' },
          is_deleted: { type: 'int', title: 'is_deleted' },
          db_now: { type: 'string', title: 'db_now' },
        },
      });
      /* @id code_node_IBseed */ const code_node_IBseed = await code('Lock seed: the missing rows (free_token 1)', "// INVENTORY_BULK_APPLY lock seed: a lock row per key, inserted once (free_token 1), as INVENTORY_APPLY_OPERATION seeds them\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst keys = [{{node:code_node_IBguard.data.lockKeys}}][0] || [];\nconst org = s([{{node:code_node_IBguard.data.organizationId}}][0]);\nconst rows = [{{node:sql_node_IBlk1.data}}][0];\nconst list = Array.isArray(rows) ? rows : rows ? [rows] : [];\nconst have = {};\nconst deleted = [];\nfor (const r of list) {\n  if (!r || r.lock_key === undefined || r.lock_key === null || r.lock_key === \"\") continue;\n  have[s(r.lock_key).toUpperCase()] = true;\n  if (Number(r.is_deleted || 0) !== 0) deleted.push(s(r.lock_key));\n}\nif (deleted.length) throw new Error(\"IBA_LOCK_SEED: soft-deleted lock rows occupy \" + deleted.join(\",\"));\nconst rowsToAdd = [];\nfor (const k of keys) {\n  if (have[k.toUpperCase()]) continue;\n  rowsToAdd.push({ organization_id: org, lock_key: k, balance_type: k.split(\"|\")[0], free_token: 1, lock_version: 0, owner_operation_id: \"\", last_owner_operation_id: \"\" });\n}\nconst batches = [];\nfor (let i = 0; i < rowsToAdd.length; i += 250) batches.push({ from: i });\nreturn { rowsToAdd: rowsToAdd, batches: batches, needSeed: rowsToAdd.length ? \"YES\" : \"NO\" };\n", {
        outputs: {
          rowsToAdd: { type: 'array', title: 'rowsToAdd', items: 'any' },
          batches: { type: 'array', title: 'batches', items: 'any' },
          needSeed: { type: 'string', title: 'needSeed' },
        },
      });
      /* @id cor_IBseed */ switchFirst('Lock rows to seed?')
        .case('YES', rule({ field: code_node_IBseed.needSeed, op: 'equal', value: 'YES' }), async () => {
          /* @id set_cache_IBsdIdx0 */ const set_cache_IBsdIdx0 = await setCache("Seed slice index = 0 (per run: the key carries the run's nonce)", {
            key: 'iba_sd_{{node:code_node_IBguard.data.nonce}}',
            value: '0', ttl: 3600000,
          });
          /* @id loop_IBseed @title "Seed the lock rows in slices of <= 250" */ for (const _item of code_node_IBseed.batches) {
            /* @id get_cache_IBsdIdx */ const get_cache_IBsdIdx = await getCache('Seed slice index', { key: 'iba_sd_{{node:code_node_IBguard.data.nonce}}' });
            /* @id code_node_IBsdSlice */ const code_node_IBsdSlice = await code('Seed slice', "// INVENTORY_BULK_APPLY slice of rowsToAdd: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBseed.data.rowsToAdd}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBsdIdx.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
              outputs: {
                rows: { type: 'array', title: 'rows', items: 'any' },
                count: { type: 'string', title: 'count' },
                nextIndex: { type: 'string', title: 'nextIndex' },
              },
            });
            /* @id add_node_IBseed */ await add('Lock seed insert (unique tenant / organization / lock_key: a twin insert fails)', {
              props: {
                organization_id: code_node_IBsdSlice.rows.organization_id,
                lock_key: code_node_IBsdSlice.rows.lock_key,
                balance_type: code_node_IBsdSlice.rows.balance_type,
                free_token: code_node_IBsdSlice.rows.free_token,
                lock_version: code_node_IBsdSlice.rows.lock_version,
                owner_operation_id: code_node_IBsdSlice.rows.owner_operation_id,
                last_owner_operation_id: code_node_IBsdSlice.rows.last_owner_operation_id,
              },
              table: t.Inventory_Balance_Lock,
            });
            /* @id set_cache_IBsdIdxN */ const set_cache_IBsdIdxN = await setCache('Next seed slice index', {
              key: 'iba_sd_{{node:code_node_IBguard.data.nonce}}',
              value: code_node_IBsdSlice.nextIndex, ttl: 3600000,
            });
          }
        })
        .default('NO', async () => {});
      /* @id sql_node_IBlk2 */ const sql_node_IBlk2 = await sql('Lock claim: the lock rows before the take', { table: t.Inventory_Balance_Lock,
        sql:
          'SELECT CAST(id AS CHAR) AS id, lock_key, free_token, owner_operation_id,\n' +
          "       DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now\n" +
          '  FROM inventory_balance_lock\n' +
          ' WHERE tenant_id = ?\n' +
          '   AND organization_id = ?\n' +
          '   AND lock_key IN (SELECT jt.k FROM JSON_TABLE(?, \'$[*]\' COLUMNS (k VARCHAR(128) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH \'$\')) jt)\n' +
          '   AND is_deleted = 0\n' +
          ' ORDER BY lock_key',
        params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.lockKeysJson],
        outputs: {
          id: { type: 'string', title: 'id' },
          lock_key: { type: 'string', title: 'lock_key' },
          free_token: { type: 'int', title: 'free_token' },
          owner_operation_id: { type: 'string', title: 'owner_operation_id' },
          db_now: { type: 'string', title: 'db_now' },
        },
      });
      /* @id code_node_IBclaim */ const code_node_IBclaim = await code('Lock claim: BUSY / TAKE / HELD', "// INVENTORY_BULK_APPLY lock claim: keys in lock order; a key another operation holds -> BUSY before any take,\n// a key this operation already holds (a run that died) is kept\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst keys = [{{node:code_node_IBguard.data.lockKeys}}][0] || [];\nconst op = s([{{node:code_node_IBguard.data.operationKey}}][0]);\nconst rows = [{{node:sql_node_IBlk2.data}}][0];\nconst list = Array.isArray(rows) ? rows : rows ? [rows] : [];\nconst byKey = {};\nlet dbNow = \"\";\nfor (const r of list) {\n  if (!r || !r.lock_key) continue;\n  byKey[s(r.lock_key).toUpperCase()] = r;\n  if (!dbNow && r.db_now) dbNow = s(r.db_now);\n}\nconst take = [];\nconst busy = [];\nconst missing = [];\nfor (const k of keys) {\n  const r = byKey[k.toUpperCase()];\n  if (!r || !/^[0-9]{1,20}$/.test(s(r.id))) {\n    missing.push(k);\n    continue;\n  }\n  const t = Number(r.free_token);\n  if (t === 1) take.push(s(r.id));\n  else if (t === 0 && s(r.owner_operation_id) === op) continue;\n  else busy.push(k + (s(r.owner_operation_id) ? \" (\" + s(r.owner_operation_id) + \")\" : \"\"));\n}\nif (missing.length) throw new Error(\"IBA_LOCK_SEED_INCOMPLETE: \" + missing.slice(0, 20).join(\",\"));\nif (!dbNow) throw new Error(\"IBA_LOCK_INPUT: the lock read returned no db_now\");\nconst route = busy.length ? \"BUSY\" : take.length ? \"TAKE\" : \"HELD\";\nreturn { route: route, ids: take, claimedAt: dbNow, busy: busy.slice(0, 20).join(\", \"), busyCount: String(busy.length) };\n", {
        outputs: {
          route: { type: 'string', title: 'route' },
          ids: { type: 'array', title: 'ids', items: 'any' },
          claimedAt: { type: 'string', title: 'claimedAt' },
          busy: { type: 'string', title: 'busy' },
          busyCount: { type: 'string', title: 'busyCount' },
        },
      });
      /* @id if_IBbusy @title "IF another operation holds a key: answer 409 LOCK_BUSY before taking anything" */ if (
        rule({ field: code_node_IBclaim.route, op: 'equal', value: 'BUSY' })
      ) {
        /* @id return_node_IBbusy */ return {
          status: 200,
          code: '409',
          result_code: 'LOCK_BUSY',
          message: code_node_IBclaim.busy,
        };
      }
      /* @id cor_IBtake */ switchFirst('Keys to take?')
        .case('YES', rule({ field: code_node_IBclaim.route, op: 'equal', value: 'TAKE' }), async () => {
          /* @id workflow_node_IBtake */ const workflow_node_IBtake = await callWorkflow('Lock take: INVENTORY_LOCK_TOKENS TAKE, in lock order', {
            inputs: {
              mode: 'TAKE',
              operation_id: code_node_IBguard.operationKey,
              organization_id: code_node_IBguard.organizationId,
              claimed_at: code_node_IBclaim.claimedAt,
              ids: code_node_IBclaim.ids,
            },
            use: workflows.INVENTORY_LOCK_TOKENS,
          });
        })
        .default('NO', async () => {});
      /* @id sql_node_IBlk3 */ const sql_node_IBlk3 = await sql('Lock verify: the lock rows after the take', { table: t.Inventory_Balance_Lock,
        sql:
          'SELECT CAST(id AS CHAR) AS id, lock_key, free_token, owner_operation_id\n' +
          '  FROM inventory_balance_lock\n' +
          ' WHERE tenant_id = ?\n' +
          '   AND organization_id = ?\n' +
          '   AND lock_key IN (SELECT jt.k FROM JSON_TABLE(?, \'$[*]\' COLUMNS (k VARCHAR(128) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH \'$\')) jt)\n' +
          '   AND is_deleted = 0',
        params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.lockKeysJson],
        outputs: {
          id: { type: 'string', title: 'id' },
          lock_key: { type: 'string', title: 'lock_key' },
          free_token: { type: 'int', title: 'free_token' },
          owner_operation_id: { type: 'string', title: 'owner_operation_id' },
        },
      });
      /* @id code_node_IBlkv */ const code_node_IBlkv = await code('Lock verify: every key held by this operation, else LOST', "// INVENTORY_BULK_APPLY lock verify: every key reads token 0 with this operation as owner, else LOST\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst keys = [{{node:code_node_IBguard.data.lockKeys}}][0] || [];\nconst op = s([{{node:code_node_IBguard.data.operationKey}}][0]);\nconst rows = [{{node:sql_node_IBlk3.data}}][0];\nconst list = Array.isArray(rows) ? rows : rows ? [rows] : [];\nconst byKey = {};\nfor (const r of list) if (r && r.lock_key) byKey[s(r.lock_key).toUpperCase()] = r;\nconst lost = [];\nfor (const k of keys) {\n  const r = byKey[k.toUpperCase()];\n  if (!r || Number(r.free_token) !== 0 || s(r.owner_operation_id) !== op) lost.push(k);\n}\nreturn { route: lost.length ? \"LOST\" : \"HELD\", lost: lost.slice(0, 20).join(\",\"), lostCount: String(lost.length) };\n", {
        outputs: {
          route: { type: 'string', title: 'route' },
          lost: { type: 'string', title: 'lost' },
          lostCount: { type: 'string', title: 'lostCount' },
        },
      });
    }
    /* @id cond_all_IBread */ parallel('Reads (under the locks on APPLY)')
      .branch('Items', async () => {
        /* @id sql_node_IBitems */ const sql_node_IBitems = await sql('Items: costing method, stock control, base unit, unit conversions', { table: t.Item,
          sql:
            'SELECT CAST(i.id AS CHAR) AS id,\n' +
            '       i.item_batch_management,\n' +
            '       i.stock_control,\n' +
            '       CAST(i.based_uom AS CHAR) AS based_uom,\n' +
            '       i.material_costing_method,\n' +
            '       CAST(i.purchase_unit_price AS CHAR) AS purchase_unit_price,\n' +
            '       COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(\n' +
            "                  'alt_uom_id', CAST(u.alt_uom_id AS CHAR),\n" +
            "                  'base_qty', u.base_qty))\n" +
            '                   FROM item_mji552rc_sub u\n' +
            '                  WHERE u.Item_id = i.id\n' +
            "                    AND u.is_deleted = 0), '[]') AS uom_conversion_json\n" +
            "  FROM JSON_TABLE(CONCAT('[', ?, ']'), '$[*]' COLUMNS (mid BIGINT PATH '$')) sel\n" +
            '  JOIN item i\n' +
            '    ON i.id = sel.mid\n' +
            '   AND i.is_deleted = 0',
          params: [code_node_IBguard.materialIdsCsv],
          outputs: {
            id: { type: 'string', title: 'id' },
            item_batch_management: { type: 'string', title: 'item_batch_management' },
            stock_control: { type: 'string', title: 'stock_control' },
            based_uom: { type: 'string', title: 'based_uom' },
            material_costing_method: { type: 'string', title: 'material_costing_method' },
            purchase_unit_price: { type: 'string', title: 'purchase_unit_price' },
            uom_conversion_json: { type: 'string', title: 'uom_conversion_json' },
          },
        });
      })
      .branch('Balances', async () => {
        /* @id sql_node_IBbal */ const sql_node_IBbal = await sql('item_balance rows of the movements', { table: t.Item_Balance,
          sql: "SELECT CAST(b.id AS CHAR) AS id, CAST(b.material_id AS CHAR) AS material_id, CAST(b.location_id AS CHAR) AS location_id,\n" +
            "       CAST(b.plant_id AS CHAR) AS plant_id, b.organization_id,\n" +
            "       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty,\n" +
            "       CAST(b.reserved_qty AS CHAR) AS reserved_qty,\n" +
            "       CAST(b.block_qty AS CHAR) AS block_qty,\n" +
            "       CAST(b.qualityinsp_qty AS CHAR) AS qualityinsp_qty,\n" +
            "       CAST(b.intransit_qty AS CHAR) AS intransit_qty,\n" +
            "       CAST(b.balance_quantity AS CHAR) AS balance_quantity\n" +
            "  FROM item_balance b\n" +
            " WHERE b.tenant_id = ?\n" +
            "   AND b.organization_id = ?\n" +
            "   AND b.is_deleted = 0\n" +
            "   AND (b.material_id, b.location_id, b.plant_id) IN (SELECT jt.m, jt.l, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]', p BIGINT PATH '$[2]')) jt)",
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.balTuplesJson],
          outputs: { id: { type: 'string', title: 'id' }, material_id: { type: 'string', title: 'material_id' }, location_id: { type: 'string', title: 'location_id' }, plant_id: { type: 'string', title: 'plant_id' }, organization_id: { type: 'string', title: 'organization_id' }, unrestricted_qty: { type: 'string', title: 'unrestricted_qty' }, reserved_qty: { type: 'string', title: 'reserved_qty' }, block_qty: { type: 'string', title: 'block_qty' }, qualityinsp_qty: { type: 'string', title: 'qualityinsp_qty' }, intransit_qty: { type: 'string', title: 'intransit_qty' }, balance_quantity: { type: 'string', title: 'balance_quantity' } },
        });
      })
      .branch('Batch balances', async () => {
        /* @id sql_node_IBbatch */ const sql_node_IBbatch = await sql('item_batch_balance rows of the movements', { table: t.Item_Batch_Balance,
          sql: "SELECT CAST(b.id AS CHAR) AS id, CAST(b.material_id AS CHAR) AS material_id, CAST(b.location_id AS CHAR) AS location_id,\n" +
            "       CAST(b.batch_id AS CHAR) AS batch_id, CAST(b.plant_id AS CHAR) AS plant_id, b.organization_id,\n" +
            "       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty,\n" +
            "       CAST(b.reserved_qty AS CHAR) AS reserved_qty,\n" +
            "       CAST(b.block_qty AS CHAR) AS block_qty,\n" +
            "       CAST(b.qualityinsp_qty AS CHAR) AS qualityinsp_qty,\n" +
            "       CAST(b.intransit_qty AS CHAR) AS intransit_qty,\n" +
            "       CAST(b.balance_quantity AS CHAR) AS balance_quantity,\n" +
            "       DATE_FORMAT(b.manufacturing_date, '%Y-%m-%d %H:%i:%s') AS manufacturing_date,\n" +
            "       DATE_FORMAT(b.expired_date, '%Y-%m-%d %H:%i:%s') AS expired_date,\n" +
            "       b.remark, b.remark2, b.remark3\n" +
            "  FROM item_batch_balance b\n" +
            " WHERE b.tenant_id = ?\n" +
            "   AND b.organization_id = ?\n" +
            "   AND b.is_deleted = 0\n" +
            "   AND (b.material_id, b.location_id, b.batch_id, b.plant_id) IN (SELECT jt.m, jt.l, jt.b, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]', b BIGINT PATH '$[2]', p BIGINT PATH '$[3]')) jt)",
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.batchTuplesJson],
          outputs: { id: { type: 'string', title: 'id' }, material_id: { type: 'string', title: 'material_id' }, location_id: { type: 'string', title: 'location_id' }, batch_id: { type: 'string', title: 'batch_id' }, plant_id: { type: 'string', title: 'plant_id' }, organization_id: { type: 'string', title: 'organization_id' }, unrestricted_qty: { type: 'string', title: 'unrestricted_qty' }, reserved_qty: { type: 'string', title: 'reserved_qty' }, block_qty: { type: 'string', title: 'block_qty' }, qualityinsp_qty: { type: 'string', title: 'qualityinsp_qty' }, intransit_qty: { type: 'string', title: 'intransit_qty' }, balance_quantity: { type: 'string', title: 'balance_quantity' }, manufacturing_date: { type: 'string', title: 'manufacturing_date' }, expired_date: { type: 'string', title: 'expired_date' }, remark: { type: 'string', title: 'remark' }, remark2: { type: 'string', title: 'remark2' }, remark3: { type: 'string', title: 'remark3' } },
        });
      })
      .branch('FIFO', async () => {
        /* @id sql_node_IBfifo */ const sql_node_IBfifo = await sql('FIFO layers of the materials and plants (every batch)', { table: t.FIFO_Costing_History,
          sql: "SELECT CAST(f.id AS CHAR) AS id, CAST(f.material_id AS CHAR) AS material_id, CAST(f.plant_id AS CHAR) AS plant_id,\n" +
            "       f.organization_id, CAST(COALESCE(f.batch_id, 0) AS CHAR) AS batch_id, f.fifo_sequence,\n" +
            "       CAST(f.fifo_cost_price AS CHAR) AS fifo_cost_price, CAST(f.fifo_initial_quantity AS CHAR) AS fifo_initial_quantity,\n" +
            "       CAST(f.fifo_available_quantity AS CHAR) AS fifo_available_quantity\n" +
            "  FROM fifo_costing_history f\n" +
            " WHERE f.tenant_id = ?\n" +
            "   AND f.organization_id = ?\n" +
            "   AND f.is_deleted = 0\n" +
            "   AND (f.material_id, f.plant_id) IN (SELECT jt.m, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', p BIGINT PATH '$[1]')) jt)\n" +
            " ORDER BY f.id",
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.costPairsJson],
          outputs: { id: { type: 'string', title: 'id' }, material_id: { type: 'string', title: 'material_id' }, plant_id: { type: 'string', title: 'plant_id' }, organization_id: { type: 'string', title: 'organization_id' }, batch_id: { type: 'string', title: 'batch_id' }, fifo_sequence: { type: 'string', title: 'fifo_sequence' }, fifo_cost_price: { type: 'string', title: 'fifo_cost_price' }, fifo_initial_quantity: { type: 'string', title: 'fifo_initial_quantity' }, fifo_available_quantity: { type: 'string', title: 'fifo_available_quantity' } },
        });
      })
      .branch('WA', async () => {
        /* @id sql_node_IBwa */ const sql_node_IBwa = await sql('Weighted Average rows of the materials and plants (every batch)', { table: t.Weighted_Average_Costing_History,
          sql: "SELECT CAST(w.id AS CHAR) AS id, CAST(w.material_id AS CHAR) AS material_id, w.plant_id, w.organization_id,\n" +
            "       CAST(COALESCE(w.batch_id, 0) AS CHAR) AS batch_id, CAST(w.wa_quantity AS CHAR) AS wa_quantity,\n" +
            "       CAST(w.wa_cost_price AS CHAR) AS wa_cost_price, w.created_at\n" +
            "  FROM wa_costing_method w\n" +
            " WHERE w.tenant_id = ?\n" +
            "   AND w.organization_id = ?\n" +
            "   AND w.is_deleted = 0\n" +
            "   AND (w.material_id, w.plant_id) IN (SELECT jt.m, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', p BIGINT PATH '$[1]')) jt)\n" +
            " ORDER BY w.id",
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.costPairsJson],
          outputs: { id: { type: 'string', title: 'id' }, material_id: { type: 'string', title: 'material_id' }, plant_id: { type: 'string', title: 'plant_id' }, organization_id: { type: 'string', title: 'organization_id' }, batch_id: { type: 'string', title: 'batch_id' }, wa_quantity: { type: 'string', title: 'wa_quantity' }, wa_cost_price: { type: 'string', title: 'wa_cost_price' }, created_at: { type: 'string', title: 'created_at' } },
        });
      })
      .branch('Movements already written', rule({ field: code_node_IBstate.route, op: 'equal', value: 'RESUME' }), async () => {
        /* @id sql_node_IBmv */ const sql_node_IBmv = await sql('inventory_movement rows of this operation (a resumed run adds only the missing ones)', { table: t.Inventory_Movement,
          sql: "SELECT m.operation_effect_key\n" +
            "  FROM inventory_movement m\n" +
            " WHERE m.tenant_id = ?\n" +
            "   AND m.operation_effect_key IN (SELECT jt.k FROM JSON_TABLE(?, '$[*]' COLUMNS (k VARCHAR(255) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) jt)\n" +
            "   AND m.is_deleted = 0",
          params: [code_node_IBguard.tenantId, code_node_IBguard.effectKeysJson],
          outputs: { operation_effect_key: { type: 'string', title: 'operation_effect_key' } },
        });
      });
    /* @id code_node_IBplan */ const code_node_IBplan = await code('Plan: replay the movements (or compare the stored intent) -> rows to write', "// INVENTORY_BULK_APPLY plan: replay the movements over the rows read (fresh), or compare a stored intent with them (resume)\n// INVENTORY_BULK_APPLY planner. Replays SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW in list order over in-memory\n// copies of the rows those workflows read, so every movement sees the writes of the ones before it, then returns\n// each touched row once (before/after) plus the inventory_movement rows. All-or-nothing: the first movement the old\n// workflows would fail fails the whole plan and nothing is written.\nconst q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst CATEGORY_FIELD = {\n  Unrestricted: \"unrestricted_qty\",\n  Reserved: \"reserved_qty\",\n  Blocked: \"block_qty\",\n  \"Quality Inspection\": \"qualityinsp_qty\",\n  \"In Transit\": \"intransit_qty\",\n};\nconst QTY_COLS = [\"unrestricted_qty\", \"reserved_qty\", \"block_qty\", \"qualityinsp_qty\", \"intransit_qty\", \"balance_quantity\"];\nconst FIFO = \"First In First Out\";\nconst WA = \"Weighted Average\";\nconst FIXED = \"Fixed Cost\";\n\nfunction planBulk(input) {\n  const movements = Array.isArray(input.movements) ? input.movements : [];\n  const items = input.items || {};\n  const nowText = input.nowText || \"\";\n  let seq = 0;\n  const newId = (kind) => \"new:\" + kind + \":\" + ++seq;\n\n  // ---------------------------------------------------------------- indexed state (copies; originals kept for before)\n  const index = (rows, keyOf) => {\n    const map = {};\n    const dup = {};\n    for (const r of rows || []) {\n      const k = keyOf(r);\n      if (map[k]) dup[k] = true;\n      else map[k] = r;\n    }\n    return { map, dup };\n  };\n  const cloneRows = (rows) => (rows || []).map((r) => Object.assign({}, r, { id: s(r.id) }));\n  const balKey = (m, loc, plant, org) => [s(m), s(loc), s(plant), s(org)].join(\"|\");\n  const batchKey = (m, loc, batch, plant, org) => [s(m), s(loc), s(batch), s(plant), s(org)].join(\"|\");\n  const costKey = (m, plant, org, batch) => [s(m), s(plant), s(org), s(batch)].join(\"|\");\n\n  const itemBalIdx = index(cloneRows(input.itemBalances), (r) => balKey(r.material_id, r.location_id, r.plant_id, r.organization_id));\n  const batchBalIdx = index(cloneRows(input.batchBalances), (r) => batchKey(r.material_id, r.location_id, r.batch_id, r.plant_id, r.organization_id));\n  const fifoRows = cloneRows(input.fifoLayers);\n  const waRows = cloneRows(input.waRows);\n\n  const before = { item_balance: {}, item_batch_balance: {}, fifo: {}, wa: {} };\n  const touched = { item_balance: {}, item_batch_balance: {}, fifo: {}, wa: {} };\n  const created = { item_balance: [], item_batch_balance: [], fifo: [], wa: [], batch: [] };\n  const snap = (table, row, cols) => {\n    if (row.id.indexOf(\"new:\") === 0 || before[table][row.id]) return;\n    const b = {};\n    for (const c of cols) b[c] = row[c] === undefined ? null : row[c];\n    before[table][row.id] = b;\n  };\n  const touch = (table, row) => {\n    if (row.id.indexOf(\"new:\") !== 0) touched[table][row.id] = row;\n  };\n\n  const results = [];\n  const movementRows = [];\n  const byKey = {};\n  const fail = (m, code, message) => ({ ok: false, failure: { code, movement_key: s(m && m.movement_key), message }, results });\n\n  const uomOf = (item, m) => {\n    const altQty = q8(parseFloat(m.quantity));\n    let baseQty = altQty;\n    const altUOM = m.material_uom || item.based_uom;\n    const conv = Array.isArray(item.table_uom_conversion) ? item.table_uom_conversion.find((c) => c.alt_uom_id === altUOM) : null;\n    if (conv) baseQty = q8(altQty * conv.base_qty);\n    return { altQty, baseQty, altUOM, baseUOM: item.based_uom, method: item.material_costing_method };\n  };\n  const fifoFor = (m, plant, org, batch) => fifoRows.filter((r) => costKey(r.material_id, r.plant_id, r.organization_id, r.batch_id) === costKey(m, plant, org, batch));\n  const waFor = (m, plant, org, batch) => waRows.filter((r) => costKey(r.material_id, r.plant_id, r.organization_id, r.batch_id) === costKey(m, plant, org, batch));\n  const newestWa = (rows) =>\n    rows.slice().sort((a, b) => (a.created_at && b.created_at ? new Date(b.created_at) - new Date(a.created_at) : 0))[0];\n\n  for (const m of movements) {\n    const key = s(m.movement_key);\n    if (!key || byKey[key]) return fail(m, \"REQUEST_INVALID\", \"movement_key missing or repeated: \" + key);\n    const dir = s(m.direction);\n    if (dir !== \"SUBTRACT\" && dir !== \"ADD\") return fail(m, \"REQUEST_INVALID\", \"direction must be SUBTRACT or ADD\");\n\n    // a release pair: the ADD takes the price and dates its SUBTRACT computed (GD_UNUSED_FN_NEW passes them on)\n    if (m.unit_price_from) {\n      const src = byKey[s(m.unit_price_from)];\n      if (!src) return fail(m, \"REQUEST_INVALID\", \"unit_price_from \" + s(m.unit_price_from) + \" is not an earlier movement\");\n      m.unit_price = src.unit_price;\n      m.manufacturing_date = src.manufacturing_date;\n      m.expired_date = src.expired_date;\n    }\n\n    const qtyNum = parseFloat(m.quantity);\n    const missing = !s(m.material_id) || m.quantity === undefined || m.quantity === null || !(qtyNum > 0) || !s(m.plant_id) || !s(m.organization_id);\n    if (missing || (dir === \"SUBTRACT\" && !s(m.inventory_category))) return fail(m, \"VALIDATION_FAILED\", \"Validation Failed\");\n\n    const item = items[s(m.material_id)];\n    if (!item) return fail(m, \"ITEM_NOT_FOUND\", \"Item \" + s(m.material_id) + \" not found\");\n    if (Number(item.stock_control) === 0) {\n      const r = { movement_key: key, direction: dir, code: \"401\", message: \"Skipping inventory update for item (stock control = 0)\" };\n      results.push(r);\n      byKey[key] = r;\n      continue;\n    }\n    const u = uomOf(item, m);\n    const isMovingInv = m.isMovingInv === undefined || m.isMovingInv === null ? 0 : Number(m.isMovingInv);\n    const plant = s(m.plant_id);\n    const org = s(m.organization_id);\n    const mat = s(m.material_id);\n    const loc = s(m.location_id);\n\n    if (dir === \"SUBTRACT\") {\n      const batch = s(m.batch_id);\n      const categoryField = CATEGORY_FIELD[m.inventory_category];\n      const bk = balKey(mat, loc, plant, org);\n      if (itemBalIdx.dup[bk]) return fail(m, \"DUPLICATE_BALANCE\", \"More than one item_balance row for \" + bk);\n      const itemRow = itemBalIdx.map[bk] || null;\n      let batchRow = null;\n      if (batch) {\n        const tk = batchKey(mat, loc, batch, plant, org);\n        if (batchBalIdx.dup[tk]) return fail(m, \"DUPLICATE_BALANCE\", \"More than one item_batch_balance row for \" + tk);\n        batchRow = batchBalIdx.map[tk] || null;\n        if (!batchRow && !itemRow) return fail(m, \"BALANCE_NOT_FOUND\", \"Balance not found\");\n      }\n      const existing = (batch ? batchRow : itemRow) || {};\n      let mfg = m.manufacturing_date || null;\n      let exp = m.expired_date || null;\n      if (batch && (!mfg || !exp)) {\n        mfg = existing.manufacturing_date === undefined ? null : existing.manufacturing_date;\n        exp = existing.expired_date === undefined ? null : existing.expired_date;\n      }\n      if (q8(existing[categoryField] || 0) < u.baseQty) return fail(m, \"INSUFFICIENT\", \"Insufficient quantity\");\n\n      const fifo = fifoFor(mat, plant, org, batch || null);\n      const wa = waFor(mat, plant, org, batch || null);\n      // SUBTRACT's \"Migration Condition\": the old branch rewrites costing rows from stale reads - refused here\n      if ((wa.length > 0 && fifo.length > 0) || (u.method === FIFO && fifo.length === 0 && wa.length > 0) || (u.method === WA && wa.length === 0 && fifo.length > 0)) {\n        return fail(m, \"UNSUPPORTED_COSTING\", \"Item \" + mat + \" has costing rows that need migration (FIFO \" + fifo.length + \", WA \" + wa.length + \")\");\n      }\n\n      let price = 0;\n      if (isMovingInv === 1 && m.unit_price) price = q8(m.unit_price);\n      else if (u.method === FIFO) price = fifoUnitPrice(fifo, u.baseQty);\n      else if (u.method === WA) price = wa.length ? q8(newestWa(wa).wa_cost_price || 0) : 0;\n      else if (u.method === FIXED) price = q8(parseFloat(item.purchase_unit_price || 0));\n      const totalPrice = q8(price * u.baseQty);\n\n      const deduct = (row) => {\n        snap(row === itemRow ? \"item_balance\" : \"item_batch_balance\", row, QTY_COLS);\n        for (const c of QTY_COLS.slice(0, 5)) row[c] = q8(q8(row[c] || 0) - (c === categoryField ? u.baseQty : 0));\n        row.balance_quantity = q8(q8(row.balance_quantity || 0) - u.baseQty);\n      };\n      if (itemRow) {\n        deduct(itemRow);\n        touch(\"item_balance\", itemRow);\n      }\n      if (batch && batchRow) {\n        snap(\"item_batch_balance\", batchRow, QTY_COLS);\n        for (const c of QTY_COLS.slice(0, 5)) batchRow[c] = q8(q8(batchRow[c] || 0) - (c === categoryField ? u.baseQty : 0));\n        batchRow.balance_quantity = q8(q8(batchRow.balance_quantity || 0) - u.baseQty);\n        touch(\"item_batch_balance\", batchRow);\n      }\n\n      if (isMovingInv === 0) {\n        if (u.method === FIFO) {\n          let remaining = q8(u.baseQty);\n          for (const layer of fifo.slice().sort((a, b) => (a.fifo_sequence || 0) - (b.fifo_sequence || 0))) {\n            if (remaining <= 0) break;\n            const avail = q8(layer.fifo_available_quantity || 0);\n            if (avail <= 0) continue;\n            const take = Math.min(remaining, avail);\n            snap(\"fifo\", layer, [\"fifo_available_quantity\"]);\n            layer.fifo_available_quantity = q8(q8(avail - take));\n            touch(\"fifo\", layer);\n            remaining = q8(remaining - take);\n          }\n        } else if (u.method === WA) {\n          const doc = newestWa(wa);\n          if (!doc) {\n            return fail(m, \"NO_WA_RECORD\", \"No Weighted Average costing record for material \" + mat + \", batch \" + (batch || \"(none)\") + \", plant \" + plant + \" -- create the costing record for this plant before issuing this stock.\");\n          }\n          snap(\"wa\", doc, [\"wa_quantity\", \"wa_cost_price\"]);\n          doc.wa_quantity = Math.max(0, q8(q8(doc.wa_quantity || 0) - q8(u.baseQty)));\n          touch(\"wa\", doc);\n        }\n      }\n\n      movementRows.push({\n        operation_effect_key: s(input.operationKey) + \"|\" + key,\n        transaction_type: m.transaction_type,\n        trx_no: m.trx_no,\n        inventory_category: m.inventory_category,\n        parent_trx_no: m.parent_trx_no === undefined ? null : m.parent_trx_no,\n        movement: \"OUT\",\n        plant_id: plant,\n        organization_id: org,\n        unit_price: price,\n        total_price: totalPrice,\n        quantity: u.altQty,\n        base_qty: u.baseQty,\n        uom_id: u.altUOM,\n        base_uom_id: u.baseUOM,\n        item_id: mat,\n        bin_location_id: loc,\n        batch_number_id: batch || null,\n        costing_method_id: u.method,\n        manufacturing_date: mfg,\n        expired_date: exp,\n        doc_date: m.doc_date,\n        actual_qty: -u.altQty,\n        actual_base_qty: -u.baseQty,\n        handling_unit_id: m.handling_unit_id === undefined ? null : m.handling_unit_id,\n      });\n      const r = { movement_key: key, direction: dir, code: \"200\", unit_price: price, total_price: totalPrice, manufacturing_date: mfg, expired_date: exp };\n      results.push(r);\n      byKey[key] = r;\n      continue;\n    }\n\n    // ------------------------------------------------------------------------------------------------ ADD\n    const trx = m.transaction_type;\n    let unitPrice = m.unit_price;\n    let totalPrice = unitPrice * u.baseQty;\n    let costPrice = null;\n    let fixedPrice = null;\n    if (trx !== undefined && trx !== null && trx !== \"LOT\") {\n      if (u.method === FIFO || u.method === WA) {\n        let up = q8(m.unit_price);\n        let tp = q8(up * u.baseQty);\n        if (trx === \"GRN\") {\n          const poQ = q8(parseFloat(m.po_quantity) || 0);\n          const amt = q8(parseFloat(m.po_amount) || 0);\n          const conversion = q8(u.baseQty / parseFloat(m.quantity));\n          const rate = m.exchange_rate || 1;\n          const ppu = poQ > 0 ? q8(amt / poQ) : 0;\n          up = q8((ppu / conversion) * rate);\n          tp = q8(up * u.baseQty);\n        }\n        costPrice = { up, tp };\n      } else {\n        const up = q8(item.purchase_unit_price);\n        fixedPrice = { up, tp: q8(up * u.baseQty) };\n      }\n    }\n    if (trx !== \"LOT\") {\n      if (u.method === FIFO || u.method === WA) {\n        unitPrice = costPrice ? costPrice.up : undefined;\n        totalPrice = costPrice ? costPrice.tp : undefined;\n      } else if (u.method === FIXED) {\n        unitPrice = fixedPrice ? fixedPrice.up : undefined;\n        totalPrice = fixedPrice ? fixedPrice.tp : undefined;\n      }\n    }\n    unitPrice = q8(unitPrice);\n    totalPrice = q8(totalPrice);\n\n    let batchId = m.batch_id || null;\n    if (m.batch_number !== \"-\" && m.batch_number && !m.batch_id) {\n      batchId = newId(\"batch\");\n      created.batch.push({\n        id: batchId,\n        batch_number: m.batch_number,\n        material_id: mat,\n        initial_quantity: u.baseQty,\n        transaction_no: m.trx_no,\n        plant_id: plant,\n        organization_id: org,\n        remark: m.remark === undefined ? null : m.remark,\n        remark2: m.remark2 === undefined ? null : m.remark2,\n        remark3: m.remark3 === undefined ? null : m.remark3,\n        manufacturing_date: m.manufacturing_date === undefined ? null : m.manufacturing_date,\n        expired_date: m.expired_date === undefined ? null : m.expired_date,\n      });\n    }\n\n    const add = { unrestricted_qty: 0, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0 };\n    const cat = m.inventory_category;\n    const col = cat === \"Blocked\" ? \"block_qty\" : cat === \"Reserved\" ? \"reserved_qty\" : cat === \"Quality Inspection\" ? \"qualityinsp_qty\" : cat === \"In Transit\" ? \"intransit_qty\" : \"unrestricted_qty\";\n    add[col] = q8(parseFloat(u.baseQty || 0));\n    add.balance_quantity = add.block_qty + add.reserved_qty + add.unrestricted_qty + add.qualityinsp_qty + add.intransit_qty;\n\n    if (batchId) {\n      const tk = batchKey(mat, loc, batchId, plant, org);\n      if (batchBalIdx.dup[tk]) return fail(m, \"DUPLICATE_BALANCE\", \"More than one item_batch_balance row for \" + tk);\n      const row = batchBalIdx.map[tk];\n      if (row) {\n        snap(\"item_batch_balance\", row, QTY_COLS.concat([\"remark\", \"remark2\", \"remark3\"]));\n        for (const c of QTY_COLS) row[c] = q8(q8(row[c] || 0) + q8(add[c] || 0));\n        const remarkOf = (nv, ev) => (nv != null && nv !== ev ? nv : ev || \"\");\n        row.remark = remarkOf(m.remark, row.remark);\n        row.remark2 = remarkOf(m.remark2, row.remark2);\n        row.remark3 = remarkOf(m.remark3, row.remark3);\n        touch(\"item_batch_balance\", row);\n      } else {\n        const nr = Object.assign({ id: newId(\"item_batch_balance\"), material_id: mat, material_uom: u.baseUOM, location_id: loc }, add, {\n          batch_id: batchId,\n          plant_id: plant,\n          organization_id: org,\n          doc_date: m.doc_date === undefined ? null : m.doc_date,\n          manufacturing_date: m.manufacturing_date === undefined ? null : m.manufacturing_date,\n          expired_date: m.expired_date === undefined ? null : m.expired_date,\n          remark: m.remark === undefined ? null : m.remark,\n          remark2: m.remark2 === undefined ? null : m.remark2,\n          remark3: m.remark3 === undefined ? null : m.remark3,\n        });\n        batchBalIdx.map[tk] = nr;\n        created.item_batch_balance.push(nr);\n      }\n    }\n    const bk = balKey(mat, loc, plant, org);\n    if (itemBalIdx.dup[bk]) return fail(m, \"DUPLICATE_BALANCE\", \"More than one item_balance row for \" + bk);\n    const itemRow = itemBalIdx.map[bk];\n    if (itemRow) {\n      snap(\"item_balance\", itemRow, QTY_COLS);\n      for (const c of QTY_COLS) itemRow[c] = q8(q8(itemRow[c] || 0) + q8(add[c] || 0));\n      touch(\"item_balance\", itemRow);\n    } else {\n      const nr = Object.assign({ id: newId(\"item_balance\"), material_id: mat, material_uom: u.baseUOM, location_id: loc }, add, { plant_id: plant, organization_id: org });\n      itemBalIdx.map[bk] = nr;\n      created.item_balance.push(nr);\n    }\n\n    if (isMovingInv === 0) {\n      if (u.method === FIFO) {\n        const layers = fifoFor(mat, plant, org, batchId);\n        const next = layers.length ? Math.max(...layers.map((l) => parseInt(l.fifo_sequence || 0, 10)), 0) + 1 : 1;\n        const layer = {\n          id: newId(\"fifo\"),\n          fifo_cost_price: unitPrice,\n          fifo_initial_quantity: u.baseQty,\n          fifo_available_quantity: u.baseQty,\n          material_id: mat,\n          batch_id: batchId,\n          fifo_sequence: next,\n          plant_id: plant,\n          organization_id: org,\n        };\n        fifoRows.push(layer);\n        created.fifo.push(layer);\n      } else if (u.method === WA) {\n        if (batchId) {\n          const row = { id: newId(\"wa\"), wa_cost_price: unitPrice, wa_quantity: u.baseQty, material_id: mat, batch_id: batchId, plant_id: plant, organization_id: org, created_at: nowText };\n          waRows.push(row);\n          created.wa.push(row);\n        } else {\n          const any = waRows.filter((r) => s(r.material_id) === mat && s(r.plant_id) === plant && s(r.organization_id) === org);\n          if (any.length) {\n            const latest = newestWa(any);\n            const wc = q8(latest.wa_cost_price);\n            const wq = q8(latest.wa_quantity);\n            const nq = q8(wq + u.baseQty);\n            snap(\"wa\", latest, [\"wa_quantity\", \"wa_cost_price\"]);\n            latest.wa_cost_price = q8(q8((wc * wq + unitPrice * u.baseQty) / nq));\n            latest.wa_quantity = nq;\n            touch(\"wa\", latest);\n          } else {\n            const row = { id: newId(\"wa\"), wa_cost_price: unitPrice, wa_quantity: u.baseQty, material_id: mat, plant_id: plant, organization_id: org, created_at: nowText };\n            waRows.push(row);\n            created.wa.push(row);\n          }\n        }\n      }\n    }\n\n    movementRows.push({\n      operation_effect_key: s(input.operationKey) + \"|\" + key,\n      transaction_type: trx,\n      trx_no: m.trx_no,\n      inventory_category: cat,\n      parent_trx_no: m.parent_trx_no === undefined ? null : m.parent_trx_no,\n      movement: \"IN\",\n      plant_id: plant,\n      organization_id: org,\n      doc_date: m.doc_date,\n      manufacturing_date: m.manufacturing_date === undefined ? null : m.manufacturing_date,\n      expired_date: m.expired_date === undefined ? null : m.expired_date,\n      unit_price: unitPrice,\n      total_price: totalPrice,\n      quantity: u.altQty,\n      base_qty: u.baseQty,\n      uom_id: u.altUOM,\n      base_uom_id: u.baseUOM,\n      item_id: mat,\n      bin_location_id: loc,\n      batch_number_id: batchId,\n      costing_method_id: u.method,\n      actual_qty: u.altQty,\n      actual_base_qty: u.baseQty,\n      handling_unit_id: m.handling_unit_id === undefined ? null : m.handling_unit_id,\n    });\n    const r = { movement_key: key, direction: dir, code: \"200\", batch_id: batchId, unit_price: unitPrice, total_price: totalPrice };\n    results.push(r);\n    byKey[key] = r;\n  }\n\n  const updates = {};\n  for (const t of Object.keys(touched)) {\n    updates[t] = Object.keys(touched[t]).map((id) => {\n      const row = touched[t][id];\n      const cols = Object.keys(before[t][id]);\n      const after = {};\n      for (const c of cols) after[c] = row[c] === undefined ? null : row[c];\n      return { id, before: before[t][id], after };\n    });\n  }\n  return { ok: true, results, updates, creates: created, movements: movementRows };\n}\n\n// SUBTRACT_INVENTORY_NEW code_node_BnKFTznr: weighted cost of the layers the quantity would use; a shortfall is\n// priced at the highest-sequence layer, used up or not\nfunction fifoUnitPrice(layers, baseQty) {\n  if (!layers.length) return 0;\n  const sorted = layers.slice().sort((a, b) => a.fifo_sequence - b.fifo_sequence);\n  let remaining = q8(baseQty);\n  let totalCost = 0;\n  let totalQty = 0;\n  for (const r of sorted) {\n    if (remaining <= 0) break;\n    const avail = q8(r.fifo_available_quantity || 0);\n    if (avail <= 0) continue;\n    const cost = q8(r.fifo_cost_price || 0);\n    const take = Math.min(avail, remaining);\n    totalCost = q8(totalCost + take * cost);\n    totalQty = q8(totalQty + take);\n    remaining = q8(remaining - take);\n  }\n  if (remaining > 0) {\n    totalCost = q8(totalCost + remaining * q8(sorted[sorted.length - 1].fifo_cost_price || 0));\n    totalQty = q8(totalQty + remaining);\n  }\n  return totalQty > 0 ? q8(totalCost / totalQty) : 0;\n}\n\n\nconst arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);\nconst dec = (v) => {\n  const t = q8(v).toFixed(8).replace(/\\.?0+$/, \"\");\n  return t === \"-0\" || t === \"\" ? \"0\" : t;\n};\nconst SLICE = 250;\nconst CHUNK = 400000;\n\nconst bulkPlan = function bulkPlan(inp) {\n  if (s(inp.lockRoute) === \"LOST\") return { route: \"LOST\", result_code: \"LOCK_BUSY\", result_message: \"Another operation took a lock before this one could\" };\n  const route0 = s(inp.route);\n  const op = s(inp.operationKey);\n  const org = s(inp.organizationId);\n  let movements = inp.movements;\n  if (typeof movements === \"string\") movements = JSON.parse(movements);\n  const items = {};\n  for (const r of arr(inp.items)) {\n    let conv = r.uom_conversion_json;\n    if (typeof conv === \"string\") {\n      try {\n        conv = JSON.parse(conv);\n      } catch (e) {\n        conv = [];\n      }\n    }\n    items[s(r.id)] = {\n      id: s(r.id),\n      stock_control: Number(r.stock_control),\n      based_uom: s(r.based_uom),\n      material_costing_method: r.material_costing_method,\n      purchase_unit_price: Number(r.purchase_unit_price || 0),\n      item_batch_management: Number(r.item_batch_management || 0),\n      table_uom_conversion: arr(conv).map((c) => ({ alt_uom_id: s(c.alt_uom_id), base_qty: Number(c.base_qty) })),\n    };\n  }\n  const num = (rows, cols) =>\n    arr(rows).map((r) => {\n      const o = Object.assign({}, r);\n      for (const c of cols) if (o[c] !== undefined && o[c] !== null && o[c] !== \"\") o[c] = Number(o[c]);\n      return o;\n    });\n  const QTY = [\"unrestricted_qty\", \"reserved_qty\", \"block_qty\", \"qualityinsp_qty\", \"intransit_qty\", \"balance_quantity\"];\n  const bal = num(inp.itemBalances, QTY);\n  const batch = num(inp.batchBalances, QTY);\n  const fifo = num(inp.fifoLayers, [\"fifo_available_quantity\", \"fifo_cost_price\"]).map((r) => Object.assign(r, { batch_id: s(r.batch_id) === \"0\" ? null : r.batch_id }));\n  const wa = num(inp.waRows, [\"wa_quantity\", \"wa_cost_price\"]).map((r) => Object.assign(r, { batch_id: s(r.batch_id) === \"0\" ? null : r.batch_id }));\n\n  let plan;\n  let fromIntent = false;\n  if (route0 === \"RESUME\") {\n    plan = JSON.parse(s(inp.intentText));\n    fromIntent = true;\n  } else {\n    plan = planBulk({ operationKey: op, items, itemBalances: bal, batchBalances: batch, fifoLayers: fifo, waRows: wa, movements, nowText: s(inp.dbNow) });\n    if (!plan.ok) {\n      return { route: \"FAIL\", code: \"400\", result_code: plan.failure.code, result_message: plan.failure.message + \" (movement \" + plan.failure.movement_key + \")\", failure: plan.failure, results: plan.results };\n    }\n    if (route0 === \"PLAN\") {\n      return { route: \"PLAN_OK\", code: \"200\", result_code: \"OK\", result_message: \"Planned \" + plan.results.length + \" movements\", results: plan.results, summary: summaryOf(plan) };\n    }\n  }\n\n  // which planned rows still need writing: equal to after -> done; equal to before -> write; else someone else changed it\n  const current = {\n    item_balance: index(bal),\n    item_batch_balance: index(batch),\n    fifo: index(fifo),\n    wa: index(wa),\n  };\n  const conflicts = [];\n  const pending = {};\n  for (const t of [\"item_balance\", \"item_batch_balance\", \"fifo\", \"wa\"]) {\n    pending[t] = [];\n    for (const u of arr(plan.updates[t])) {\n      const row = current[t][s(u.id)];\n      if (!row) {\n        conflicts.push(t + \" \" + u.id + \" is gone\");\n        continue;\n      }\n      if (sameCols(row, u.after)) continue;\n      if (sameCols(row, u.before)) pending[t].push(u);\n      else conflicts.push(t + \" \" + u.id + \" changed since the plan\");\n    }\n  }\n  const createsLeft = { item_balance: [], item_batch_balance: [], fifo: [], wa: [] };\n  for (const t of Object.keys(createsLeft)) {\n    for (const c of arr(plan.creates[t])) {\n      if (!fromIntent) {\n        createsLeft[t].push(c);\n        continue;\n      }\n      const hit = findCreated(t, c, { item_balance: bal, item_batch_balance: batch, fifo, wa });\n      if (hit === \"SAME\") continue;\n      if (hit === \"ABSENT\") createsLeft[t].push(c);\n      else conflicts.push(t + \" new row \" + naturalKey(t, c) + \" differs\");\n    }\n  }\n  const haveMv = {};\n  for (const r of arr(inp.existingMovements)) haveMv[s(r.operation_effect_key)] = true;\n  const mvLeft = arr(plan.movements).filter((m) => !haveMv[s(m.operation_effect_key)]);\n  if (conflicts.length) {\n    return { route: \"REVIEW\", result_code: \"REQUIRES_REVIEW\", result_message: \"Rows changed under a stored plan: \" + conflicts.slice(0, 10).join(\"; \"), results: plan.results };\n  }\n\n  const ib = pending.item_balance.map((u) => Object.assign({ id: s(u.id) }, decCols(u.after)));\n  // SUBTRACT writes only the quantities; ADD also the remarks - kept apart so a quantity-only row never blanks a remark\n  const bbAll = pending.item_batch_balance.map((u) => Object.assign({ id: s(u.id) }, decCols(u.after)));\n  const bb = bbAll.filter((r) => !(\"remark\" in r));\n  const bbr = bbAll.filter((r) => \"remark\" in r);\n  const ff = pending.fifo.map((u) => ({ id: s(u.id), fifo_available_quantity: dec(u.after.fifo_available_quantity) }));\n  const wr = pending.wa.map((u) => ({ id: s(u.id), wa_quantity: dec(u.after.wa_quantity), wa_cost_price: dec(u.after.wa_cost_price) }));\n  const strip = (r) => {\n    const o = Object.assign({}, r);\n    delete o.id;\n    delete o.created_at;\n    return decCols(o);\n  };\n  const mv = mvLeft.map((m) => {\n    const o = Object.assign({}, m);\n    for (const c of [\"unit_price\", \"total_price\", \"quantity\", \"base_qty\", \"actual_qty\", \"actual_base_qty\"]) o[c] = dec(o[c]);\n    if (o.handling_unit_id === \"\") o.handling_unit_id = null;\n    return o;\n  });\n  const slices = (n) => {\n    const out = [];\n    for (let i = 0; i < n; i += SLICE) out.push({ from: i });\n    return out;\n  };\n  let intentRows = [];\n  if (!fromIntent) {\n    const text = JSON.stringify(plan);\n    const parts = [];\n    for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));\n    intentRows = parts.map((p, i) => ({ job_id: op, organization_id: org, step_name: \"IBA|I|\" + String(i + 1).padStart(3, \"0\"), step_status: \"INTENT\", attempt_count: 0, result_ref: p }));\n  }\n  const ids = (rows) => rows.map((r) => r.id).filter((x) => /^[0-9]{1,20}$/.test(x)).join(\",\") || \"0\";\n  return {\n    route: \"WRITE\",\n    result_code: \"OK\",\n    result_message: \"\",\n    results: plan.results,\n    summary: summaryOf(plan),\n    intentRows: intentRows,\n    needIntent: intentRows.length ? \"YES\" : \"NO\",\n    ib: ib,\n    ibSlices: slices(ib.length),\n    bb: bb,\n    bbSlices: slices(bb.length),\n    bbr: bbr,\n    bbrSlices: slices(bbr.length),\n    ff: ff,\n    ffSlices: slices(ff.length),\n    wa: wr,\n    waSlices: slices(wr.length),\n    ibNew: createsLeft.item_balance.map(strip),\n    ibNewSlices: slices(createsLeft.item_balance.length),\n    bbNew: createsLeft.item_batch_balance.map(strip),\n    bbNewSlices: slices(createsLeft.item_batch_balance.length),\n    ffNew: createsLeft.fifo.map(strip),\n    ffNewSlices: slices(createsLeft.fifo.length),\n    waNew: createsLeft.wa.map(strip),\n    waNewSlices: slices(createsLeft.wa.length),\n    needNew: createsLeft.item_balance.length + createsLeft.item_batch_balance.length + createsLeft.fifo.length + createsLeft.wa.length ? \"YES\" : \"NO\",\n    mv: mv,\n    mvSlices: slices(mv.length),\n    // the read-back checks every planned row, written now or by an earlier run\n    expect: {\n      item_balance: arr(plan.updates.item_balance).map((u) => [s(u.id), u.after]),\n      item_batch_balance: arr(plan.updates.item_batch_balance).map((u) => [s(u.id), u.after]),\n      fifo: arr(plan.updates.fifo).map((u) => [s(u.id), u.after]),\n      wa: arr(plan.updates.wa).map((u) => [s(u.id), u.after]),\n      movements: arr(plan.movements).length,\n    },\n    expectCreates: [\"item_balance\", \"item_batch_balance\", \"fifo\", \"wa\"].flatMap((t) =>\n      arr(plan.creates[t]).map((c) => ({ table: t, key: keyFields(t, c), values: valueFields(t, c) })),\n    ),\n    ibIdsSql: ids(arr(plan.updates.item_balance)),\n    bbIdsSql: ids(arr(plan.updates.item_batch_balance)),\n    ffIdsSql: ids(arr(plan.updates.fifo)),\n    waIdsSql: ids(arr(plan.updates.wa)),\n  };\n\n  function index(rows) {\n    const o = {};\n    for (const r of rows) o[s(r.id)] = r;\n    return o;\n  }\n  function sameCols(row, want) {\n    for (const c of Object.keys(want || {})) {\n      const a = want[c];\n      const b = row[c];\n      if (typeof a === \"number\" || (a !== null && a !== \"\" && !isNaN(Number(a)) && c.indexOf(\"remark\") < 0)) {\n        if (Math.abs(q8(a) - q8(b)) > 1e-8) return false;\n      } else if (s(a) !== s(b)) return false;\n    }\n    return true;\n  }\n  function decCols(o) {\n    const r = Object.assign({}, o);\n    for (const c of QTY.concat([\"fifo_cost_price\", \"fifo_initial_quantity\", \"fifo_available_quantity\", \"wa_quantity\", \"wa_cost_price\", \"initial_quantity\"])) {\n      if (r[c] !== undefined && r[c] !== null) r[c] = dec(r[c]);\n    }\n    return r;\n  }\n  function naturalKey(t, c) {\n    if (t === \"item_balance\") return [c.material_id, c.location_id, c.plant_id].join(\"|\");\n    if (t === \"item_batch_balance\") return [c.material_id, c.location_id, c.batch_id, c.plant_id].join(\"|\");\n    if (t === \"fifo\") return [c.material_id, c.plant_id, c.batch_id, c.fifo_sequence].join(\"|\");\n    return [c.material_id, c.plant_id, c.batch_id].join(\"|\");\n  }\n  function keyFields(t, c) {\n    const k = { material_id: s(c.material_id), plant_id: s(c.plant_id) };\n    if (t === \"item_balance\" || t === \"item_batch_balance\") k.location_id = s(c.location_id);\n    if (t !== \"item_balance\") k.batch_id = c.batch_id === undefined || c.batch_id === null ? null : s(c.batch_id);\n    if (t === \"fifo\") k.fifo_sequence = s(c.fifo_sequence);\n    return k;\n  }\n  function valueFields(t, c) {\n    const cols = t === \"fifo\" ? [\"fifo_initial_quantity\"] : t === \"wa\" ? [\"wa_quantity\", \"wa_cost_price\"] : QTY;\n    const o = {};\n    for (const col of cols) o[col] = c[col];\n    return o;\n  }\n  function findCreated(t, c, rows) {\n    const k = naturalKey(t, c);\n    const hit = arr(rows[t]).filter((r) => naturalKey(t, r) === k);\n    if (!hit.length) return \"ABSENT\";\n    const cols = t === \"fifo\" ? [\"fifo_initial_quantity\"] : t === \"wa\" ? [\"wa_quantity\", \"wa_cost_price\"] : QTY;\n    const want = {};\n    for (const col of cols) want[col] = c[col];\n    return hit.some((r) => sameCols(r, want)) ? \"SAME\" : \"OTHER\";\n  }\n};\n\nfunction summaryOf(plan) {\n  const u = plan.updates || {};\n  const c = plan.creates || {};\n  const n = (x) => (Array.isArray(x) ? x.length : 0);\n  return {\n    movements: n(plan.movements),\n    skipped: (plan.results || []).filter((r) => r.code === \"401\").length,\n    item_balance: n(u.item_balance) + n(c.item_balance),\n    item_batch_balance: n(u.item_batch_balance) + n(c.item_batch_balance),\n    fifo: n(u.fifo) + n(c.fifo),\n    wa: n(u.wa) + n(c.wa),\n  };\n}\n\nreturn bulkPlan({\n  route: [{{node:code_node_IBstate.data.route}}][0],\n  dbNow: [{{node:code_node_IBstate.data.dbNow}}][0],\n  intentText: [{{node:code_node_IBstate.data.intentText}}][0],\n  operationKey: [{{node:code_node_IBguard.data.operationKey}}][0],\n  organizationId: [{{node:code_node_IBguard.data.organizationId}}][0],\n  movements: [{{workflowparams:movements}}][0],\n  lockRoute: [{{node:code_node_IBlkv.data.route}}][0],\n  items: [{{node:sql_node_IBitems.data}}][0],\n  itemBalances: [{{node:sql_node_IBbal.data}}][0],\n  batchBalances: [{{node:sql_node_IBbatch.data}}][0],\n  fifoLayers: [{{node:sql_node_IBfifo.data}}][0],\n  waRows: [{{node:sql_node_IBwa.data}}][0],\n  existingMovements: [{{node:sql_node_IBmv.data}}][0],\n});\n", {
      outputs: {
        route: { type: 'string', title: 'route' },
        code: { type: 'string', title: 'code' },
        result_code: { type: 'string', title: 'result_code' },
        result_message: { type: 'string', title: 'result_message' },
        failure: { type: 'any', title: 'failure' },
        results: { type: 'array', title: 'results', items: 'any' },
        summary: { type: 'any', title: 'summary' },
        intentRows: { type: 'array', title: 'intentRows', items: 'any' },
        needIntent: { type: 'string', title: 'needIntent' },
        ib: { type: 'array', title: 'ib', items: 'any' },
        ibSlices: { type: 'array', title: 'ibSlices', items: 'any' },
        bb: { type: 'array', title: 'bb', items: 'any' },
        bbSlices: { type: 'array', title: 'bbSlices', items: 'any' },
        bbr: { type: 'array', title: 'bbr', items: 'any' },
        bbrSlices: { type: 'array', title: 'bbrSlices', items: 'any' },
        ff: { type: 'array', title: 'ff', items: 'any' },
        ffSlices: { type: 'array', title: 'ffSlices', items: 'any' },
        wa: { type: 'array', title: 'wa', items: 'any' },
        waSlices: { type: 'array', title: 'waSlices', items: 'any' },
        ibNew: { type: 'array', title: 'ibNew', items: 'any' },
        ibNewSlices: { type: 'array', title: 'ibNewSlices', items: 'any' },
        bbNew: { type: 'array', title: 'bbNew', items: 'any' },
        bbNewSlices: { type: 'array', title: 'bbNewSlices', items: 'any' },
        ffNew: { type: 'array', title: 'ffNew', items: 'any' },
        ffNewSlices: { type: 'array', title: 'ffNewSlices', items: 'any' },
        waNew: { type: 'array', title: 'waNew', items: 'any' },
        waNewSlices: { type: 'array', title: 'waNewSlices', items: 'any' },
        needNew: { type: 'string', title: 'needNew' },
        mv: { type: 'array', title: 'mv', items: 'any' },
        mvSlices: { type: 'array', title: 'mvSlices', items: 'any' },
        expect: { type: 'any', title: 'expect' },
        expectCreates: { type: 'array', title: 'expectCreates', items: 'any' },
        ibIdsSql: { type: 'string', title: 'ibIdsSql' },
        bbIdsSql: { type: 'string', title: 'bbIdsSql' },
        ffIdsSql: { type: 'string', title: 'ffIdsSql' },
        waIdsSql: { type: 'string', title: 'waIdsSql' },
      },
    });
    /* @id if_IBplanOk @title "IF PLAN: answer the per-movement results, write nothing" */ if (
      rule(any({ field: code_node_IBplan.route, op: 'equal', value: 'PLAN_OK' }, { field: code_node_IBstate.route, op: 'equal', value: 'PLAN' }))
    ) {
      /* @id return_node_IBplanOk */ return {
        status: 200,
        code: code_node_IBplan.code,
        result_code: code_node_IBplan.result_code,
        message: code_node_IBplan.result_message,
        results: code_node_IBplan.results,
        summary: code_node_IBplan.summary,
      };
    }
    /* @id cor_IBwrite */ switchFirst('Write the plan?')
      .case('YES', rule({ field: code_node_IBplan.route, op: 'equal', value: 'WRITE' }), async () => {
        /* @id cor_IBintent */ switchFirst('Intent to record (a fresh run)?')
          .case('YES', rule({ field: code_node_IBplan.needIntent, op: 'equal', value: 'YES' }), async () => {
            /* @id add_node_IBintent */ await add('Intent rows IBA|I|nnn: every planned row before/after + the movements (a resumed run reads them back)', {
              props: {
                job_id: code_node_IBplan.intentRows.job_id,
                organization_id: code_node_IBplan.intentRows.organization_id,
                step_name: code_node_IBplan.intentRows.step_name,
                step_status: code_node_IBplan.intentRows.step_status,
                attempt_count: code_node_IBplan.intentRows.attempt_count,
                result_ref: code_node_IBplan.intentRows.result_ref,
              },
              table: t.GD_Publish_Step,
            });
          })
          .default('NO', async () => {});
        /* @id set_cache_IBwIb0 */ const set_cache_IBwIb0 = await setCache("ib slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_ib_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwIb @title "Write ib in slices of <= 250" */ for (const _item of code_node_IBplan.ibSlices) {
          /* @id get_cache_IBwIb */ const get_cache_IBwIb = await getCache('ib slice index', { key: 'iba_ib_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwIbS */ const code_node_IBwIbS = await code('ib slice', "// INVENTORY_BULK_APPLY slice of ib: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.ib}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwIb.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id update_node_IBwIb */ const update_node_IBwIb = await update('WRITE item_balance: the six quantities (<= 250 per call)', {
              props: {
                id: code_node_IBwIbS.rows.id,
                unrestricted_qty: code_node_IBwIbS.rows.unrestricted_qty,
                reserved_qty: code_node_IBwIbS.rows.reserved_qty,
                block_qty: code_node_IBwIbS.rows.block_qty,
                qualityinsp_qty: code_node_IBwIbS.rows.qualityinsp_qty,
                intransit_qty: code_node_IBwIbS.rows.intransit_qty,
                balance_quantity: code_node_IBwIbS.rows.balance_quantity,
              },
              table: t.Item_Balance,
              where: { field: 'id', op: 'in', value: code_node_IBwIbS.rows.id, valueType: 'field' },
            });
          /* @id set_cache_IBwIbN */ const set_cache_IBwIbN = await setCache('Next ib slice index', {
            key: 'iba_ib_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwIbS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwBb0 */ const set_cache_IBwBb0 = await setCache("bb slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_bb_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwBb @title "Write bb in slices of <= 250" */ for (const _item of code_node_IBplan.bbSlices) {
          /* @id get_cache_IBwBb */ const get_cache_IBwBb = await getCache('bb slice index', { key: 'iba_bb_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwBbS */ const code_node_IBwBbS = await code('bb slice', "// INVENTORY_BULK_APPLY slice of bb: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.bb}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwBb.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id update_node_IBwBb */ const update_node_IBwBb = await update('WRITE item_batch_balance: the six quantities (<= 250 per call)', {
              props: {
                id: code_node_IBwBbS.rows.id,
                unrestricted_qty: code_node_IBwBbS.rows.unrestricted_qty,
                reserved_qty: code_node_IBwBbS.rows.reserved_qty,
                block_qty: code_node_IBwBbS.rows.block_qty,
                qualityinsp_qty: code_node_IBwBbS.rows.qualityinsp_qty,
                intransit_qty: code_node_IBwBbS.rows.intransit_qty,
                balance_quantity: code_node_IBwBbS.rows.balance_quantity,
              },
              table: t.Item_Batch_Balance,
              where: { field: 'id', op: 'in', value: code_node_IBwBbS.rows.id, valueType: 'field' },
            });
          /* @id set_cache_IBwBbN */ const set_cache_IBwBbN = await setCache('Next bb slice index', {
            key: 'iba_bb_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwBbS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwBbr0 */ const set_cache_IBwBbr0 = await setCache("bbr slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_bbr_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwBbr @title "Write bbr in slices of <= 250" */ for (const _item of code_node_IBplan.bbrSlices) {
          /* @id get_cache_IBwBbr */ const get_cache_IBwBbr = await getCache('bbr slice index', { key: 'iba_bbr_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwBbrS */ const code_node_IBwBbrS = await code('bbr slice', "// INVENTORY_BULK_APPLY slice of bbr: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.bbr}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwBbr.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id update_node_IBwBbr */ const update_node_IBwBbr = await update('WRITE item_batch_balance: quantities + remarks (ADD) (<= 250 per call)', {
              props: {
                id: code_node_IBwBbrS.rows.id,
                unrestricted_qty: code_node_IBwBbrS.rows.unrestricted_qty,
                reserved_qty: code_node_IBwBbrS.rows.reserved_qty,
                block_qty: code_node_IBwBbrS.rows.block_qty,
                qualityinsp_qty: code_node_IBwBbrS.rows.qualityinsp_qty,
                intransit_qty: code_node_IBwBbrS.rows.intransit_qty,
                balance_quantity: code_node_IBwBbrS.rows.balance_quantity,
                remark: code_node_IBwBbrS.rows.remark,
                remark2: code_node_IBwBbrS.rows.remark2,
                remark3: code_node_IBwBbrS.rows.remark3,
              },
              table: t.Item_Batch_Balance,
              where: { field: 'id', op: 'in', value: code_node_IBwBbrS.rows.id, valueType: 'field' },
            });
          /* @id set_cache_IBwBbrN */ const set_cache_IBwBbrN = await setCache('Next bbr slice index', {
            key: 'iba_bbr_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwBbrS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwFf0 */ const set_cache_IBwFf0 = await setCache("ff slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_ff_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwFf @title "Write ff in slices of <= 250" */ for (const _item of code_node_IBplan.ffSlices) {
          /* @id get_cache_IBwFf */ const get_cache_IBwFf = await getCache('ff slice index', { key: 'iba_ff_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwFfS */ const code_node_IBwFfS = await code('ff slice', "// INVENTORY_BULK_APPLY slice of ff: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.ff}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwFf.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id update_node_IBwFf */ const update_node_IBwFf = await update('WRITE FIFO layers: fifo_available_quantity (<= 250 per call)', {
              props: {
                id: code_node_IBwFfS.rows.id,
                fifo_available_quantity: code_node_IBwFfS.rows.fifo_available_quantity,
              },
              table: t.FIFO_Costing_History,
              where: { field: 'id', op: 'in', value: code_node_IBwFfS.rows.id, valueType: 'field' },
            });
          /* @id set_cache_IBwFfN */ const set_cache_IBwFfN = await setCache('Next ff slice index', {
            key: 'iba_ff_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwFfS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwWa0 */ const set_cache_IBwWa0 = await setCache("wa slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_wa_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwWa @title "Write wa in slices of <= 250" */ for (const _item of code_node_IBplan.waSlices) {
          /* @id get_cache_IBwWa */ const get_cache_IBwWa = await getCache('wa slice index', { key: 'iba_wa_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwWaS */ const code_node_IBwWaS = await code('wa slice', "// INVENTORY_BULK_APPLY slice of wa: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.wa}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwWa.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id update_node_IBwWa */ const update_node_IBwWa = await update('WRITE Weighted Average rows (<= 250 per call)', {
              props: {
                id: code_node_IBwWaS.rows.id,
                wa_quantity: code_node_IBwWaS.rows.wa_quantity,
                wa_cost_price: code_node_IBwWaS.rows.wa_cost_price,
              },
              table: t.Weighted_Average_Costing_History,
              where: { field: 'id', op: 'in', value: code_node_IBwWaS.rows.id, valueType: 'field' },
            });
          /* @id set_cache_IBwWaN */ const set_cache_IBwWaN = await setCache('Next wa slice index', {
            key: 'iba_wa_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwWaS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwIbNew0 */ const set_cache_IBwIbNew0 = await setCache("ibNew slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_ibNew_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwIbNew @title "Write ibNew in slices of <= 250" */ for (const _item of code_node_IBplan.ibNewSlices) {
          /* @id get_cache_IBwIbNew */ const get_cache_IBwIbNew = await getCache('ibNew slice index', { key: 'iba_ibNew_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwIbNewS */ const code_node_IBwIbNewS = await code('ibNew slice', "// INVENTORY_BULK_APPLY slice of ibNew: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.ibNew}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwIbNew.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id add_node_IBwIbNew */ await add('WRITE new item_balance rows (<= 250 per call)', {
              props: {
                material_id: code_node_IBwIbNewS.rows.material_id,
                material_uom: code_node_IBwIbNewS.rows.material_uom,
                location_id: code_node_IBwIbNewS.rows.location_id,
                block_qty: code_node_IBwIbNewS.rows.block_qty,
                reserved_qty: code_node_IBwIbNewS.rows.reserved_qty,
                unrestricted_qty: code_node_IBwIbNewS.rows.unrestricted_qty,
                qualityinsp_qty: code_node_IBwIbNewS.rows.qualityinsp_qty,
                intransit_qty: code_node_IBwIbNewS.rows.intransit_qty,
                balance_quantity: code_node_IBwIbNewS.rows.balance_quantity,
                plant_id: code_node_IBwIbNewS.rows.plant_id,
                organization_id: code_node_IBwIbNewS.rows.organization_id,
              },
              table: t.Item_Balance,
            });
          /* @id set_cache_IBwIbNewN */ const set_cache_IBwIbNewN = await setCache('Next ibNew slice index', {
            key: 'iba_ibNew_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwIbNewS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwBbNew0 */ const set_cache_IBwBbNew0 = await setCache("bbNew slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_bbNew_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwBbNew @title "Write bbNew in slices of <= 250" */ for (const _item of code_node_IBplan.bbNewSlices) {
          /* @id get_cache_IBwBbNew */ const get_cache_IBwBbNew = await getCache('bbNew slice index', { key: 'iba_bbNew_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwBbNewS */ const code_node_IBwBbNewS = await code('bbNew slice', "// INVENTORY_BULK_APPLY slice of bbNew: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.bbNew}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwBbNew.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id add_node_IBwBbNew */ await add('WRITE new item_batch_balance rows (<= 250 per call)', {
              props: {
                material_id: code_node_IBwBbNewS.rows.material_id,
                material_uom: code_node_IBwBbNewS.rows.material_uom,
                location_id: code_node_IBwBbNewS.rows.location_id,
                block_qty: code_node_IBwBbNewS.rows.block_qty,
                reserved_qty: code_node_IBwBbNewS.rows.reserved_qty,
                unrestricted_qty: code_node_IBwBbNewS.rows.unrestricted_qty,
                qualityinsp_qty: code_node_IBwBbNewS.rows.qualityinsp_qty,
                intransit_qty: code_node_IBwBbNewS.rows.intransit_qty,
                balance_quantity: code_node_IBwBbNewS.rows.balance_quantity,
                batch_id: code_node_IBwBbNewS.rows.batch_id,
                plant_id: code_node_IBwBbNewS.rows.plant_id,
                organization_id: code_node_IBwBbNewS.rows.organization_id,
                doc_date: code_node_IBwBbNewS.rows.doc_date,
                manufacturing_date: code_node_IBwBbNewS.rows.manufacturing_date,
                expired_date: code_node_IBwBbNewS.rows.expired_date,
                remark: code_node_IBwBbNewS.rows.remark,
                remark2: code_node_IBwBbNewS.rows.remark2,
                remark3: code_node_IBwBbNewS.rows.remark3,
              },
              table: t.Item_Batch_Balance,
            });
          /* @id set_cache_IBwBbNewN */ const set_cache_IBwBbNewN = await setCache('Next bbNew slice index', {
            key: 'iba_bbNew_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwBbNewS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwFfNew0 */ const set_cache_IBwFfNew0 = await setCache("ffNew slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_ffNew_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwFfNew @title "Write ffNew in slices of <= 250" */ for (const _item of code_node_IBplan.ffNewSlices) {
          /* @id get_cache_IBwFfNew */ const get_cache_IBwFfNew = await getCache('ffNew slice index', { key: 'iba_ffNew_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwFfNewS */ const code_node_IBwFfNewS = await code('ffNew slice', "// INVENTORY_BULK_APPLY slice of ffNew: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.ffNew}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwFfNew.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id add_node_IBwFfNew */ await add('WRITE new FIFO layers (<= 250 per call)', {
              props: {
                fifo_cost_price: code_node_IBwFfNewS.rows.fifo_cost_price,
                fifo_initial_quantity: code_node_IBwFfNewS.rows.fifo_initial_quantity,
                fifo_available_quantity: code_node_IBwFfNewS.rows.fifo_available_quantity,
                material_id: code_node_IBwFfNewS.rows.material_id,
                batch_id: code_node_IBwFfNewS.rows.batch_id,
                fifo_sequence: code_node_IBwFfNewS.rows.fifo_sequence,
                plant_id: code_node_IBwFfNewS.rows.plant_id,
                organization_id: code_node_IBwFfNewS.rows.organization_id,
              },
              table: t.FIFO_Costing_History,
            });
          /* @id set_cache_IBwFfNewN */ const set_cache_IBwFfNewN = await setCache('Next ffNew slice index', {
            key: 'iba_ffNew_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwFfNewS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwWaNew0 */ const set_cache_IBwWaNew0 = await setCache("waNew slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_waNew_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwWaNew @title "Write waNew in slices of <= 250" */ for (const _item of code_node_IBplan.waNewSlices) {
          /* @id get_cache_IBwWaNew */ const get_cache_IBwWaNew = await getCache('waNew slice index', { key: 'iba_waNew_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwWaNewS */ const code_node_IBwWaNewS = await code('waNew slice', "// INVENTORY_BULK_APPLY slice of waNew: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.waNew}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwWaNew.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id add_node_IBwWaNew */ await add('WRITE new Weighted Average rows (<= 250 per call)', {
              props: {
                wa_cost_price: code_node_IBwWaNewS.rows.wa_cost_price,
                wa_quantity: code_node_IBwWaNewS.rows.wa_quantity,
                material_id: code_node_IBwWaNewS.rows.material_id,
                batch_id: code_node_IBwWaNewS.rows.batch_id,
                plant_id: code_node_IBwWaNewS.rows.plant_id,
                organization_id: code_node_IBwWaNewS.rows.organization_id,
              },
              table: t.Weighted_Average_Costing_History,
            });
          /* @id set_cache_IBwWaNewN */ const set_cache_IBwWaNewN = await setCache('Next waNew slice index', {
            key: 'iba_waNew_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwWaNewS.nextIndex,
            ttl: 3600000,
          });
        }
        /* @id set_cache_IBwMv0 */ const set_cache_IBwMv0 = await setCache("mv slice index = 0 (per run: the key carries the run's nonce)", {
          key: 'iba_mv_{{node:code_node_IBguard.data.nonce}}',
          value: '0',
          ttl: 3600000,
        });
        /* @id loop_IBwMv @title "Write mv in slices of <= 250" */ for (const _item of code_node_IBplan.mvSlices) {
          /* @id get_cache_IBwMv */ const get_cache_IBwMv = await getCache('mv slice index', { key: 'iba_mv_{{node:code_node_IBguard.data.nonce}}' });
          /* @id code_node_IBwMvS */ const code_node_IBwMvS = await code('mv slice', "// INVENTORY_BULK_APPLY slice of mv: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBplan.data.mv}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBwMv.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
            outputs: {
              rows: { type: 'array', title: 'rows', items: 'any' },
              count: { type: 'string', title: 'count' },
              nextIndex: { type: 'string', title: 'nextIndex' },
            },
          });
          /* @id add_node_IBwMv */ await add('WRITE inventory_movement, one row per movement, keyed operation_effect_key (<= 250 per call)', {
              props: {
                operation_effect_key: code_node_IBwMvS.rows.operation_effect_key,
                transaction_type: code_node_IBwMvS.rows.transaction_type,
                trx_no: code_node_IBwMvS.rows.trx_no,
                inventory_category: code_node_IBwMvS.rows.inventory_category,
                parent_trx_no: code_node_IBwMvS.rows.parent_trx_no,
                movement: code_node_IBwMvS.rows.movement,
                plant_id: code_node_IBwMvS.rows.plant_id,
                organization_id: code_node_IBwMvS.rows.organization_id,
                unit_price: code_node_IBwMvS.rows.unit_price,
                total_price: code_node_IBwMvS.rows.total_price,
                quantity: code_node_IBwMvS.rows.quantity,
                base_qty: code_node_IBwMvS.rows.base_qty,
                uom_id: code_node_IBwMvS.rows.uom_id,
                base_uom_id: code_node_IBwMvS.rows.base_uom_id,
                item_id: code_node_IBwMvS.rows.item_id,
                bin_location_id: code_node_IBwMvS.rows.bin_location_id,
                batch_number_id: code_node_IBwMvS.rows.batch_number_id,
                costing_method_id: code_node_IBwMvS.rows.costing_method_id,
                manufacturing_date: code_node_IBwMvS.rows.manufacturing_date,
                expired_date: code_node_IBwMvS.rows.expired_date,
                doc_date: code_node_IBwMvS.rows.doc_date,
                actual_qty: code_node_IBwMvS.rows.actual_qty,
                actual_base_qty: code_node_IBwMvS.rows.actual_base_qty,
                handling_unit_id: code_node_IBwMvS.rows.handling_unit_id,
              },
              table: t.Inventory_Movement,
            });
          /* @id set_cache_IBwMvN */ const set_cache_IBwMvN = await setCache('Next mv slice index', {
            key: 'iba_mv_{{node:code_node_IBguard.data.nonce}}',
            value: code_node_IBwMvS.nextIndex,
            ttl: 3600000,
          });
        }

        /* @id cond_all_IBback */ parallel('Read-back')
          .branch('Balances', async () => {
            /* @id sql_node_IBbalB */ const sql_node_IBbalB = await sql('Read-back: item_balance', { table: t.Item_Balance, sql: "SELECT CAST(b.id AS CHAR) AS id, CAST(b.material_id AS CHAR) AS material_id, CAST(b.location_id AS CHAR) AS location_id,\n" +
            "       CAST(b.plant_id AS CHAR) AS plant_id, b.organization_id,\n" +
            "       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty,\n" +
            "       CAST(b.reserved_qty AS CHAR) AS reserved_qty,\n" +
            "       CAST(b.block_qty AS CHAR) AS block_qty,\n" +
            "       CAST(b.qualityinsp_qty AS CHAR) AS qualityinsp_qty,\n" +
            "       CAST(b.intransit_qty AS CHAR) AS intransit_qty,\n" +
            "       CAST(b.balance_quantity AS CHAR) AS balance_quantity\n" +
            "  FROM item_balance b\n" +
            " WHERE b.tenant_id = ?\n" +
            "   AND b.organization_id = ?\n" +
            "   AND b.is_deleted = 0\n" +
            "   AND (b.material_id, b.location_id, b.plant_id) IN (SELECT jt.m, jt.l, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]', p BIGINT PATH '$[2]')) jt)", params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.balTuplesJson], outputs: { id: { type: 'string', title: 'id' }, material_id: { type: 'string', title: 'material_id' }, location_id: { type: 'string', title: 'location_id' }, plant_id: { type: 'string', title: 'plant_id' }, organization_id: { type: 'string', title: 'organization_id' }, unrestricted_qty: { type: 'string', title: 'unrestricted_qty' }, reserved_qty: { type: 'string', title: 'reserved_qty' }, block_qty: { type: 'string', title: 'block_qty' }, qualityinsp_qty: { type: 'string', title: 'qualityinsp_qty' }, intransit_qty: { type: 'string', title: 'intransit_qty' }, balance_quantity: { type: 'string', title: 'balance_quantity' } } });
          })
          .branch('Batch balances', async () => {
            /* @id sql_node_IBbatchB */ const sql_node_IBbatchB = await sql('Read-back: item_batch_balance', { table: t.Item_Batch_Balance, sql: "SELECT CAST(b.id AS CHAR) AS id, CAST(b.material_id AS CHAR) AS material_id, CAST(b.location_id AS CHAR) AS location_id,\n" +
            "       CAST(b.batch_id AS CHAR) AS batch_id, CAST(b.plant_id AS CHAR) AS plant_id, b.organization_id,\n" +
            "       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty,\n" +
            "       CAST(b.reserved_qty AS CHAR) AS reserved_qty,\n" +
            "       CAST(b.block_qty AS CHAR) AS block_qty,\n" +
            "       CAST(b.qualityinsp_qty AS CHAR) AS qualityinsp_qty,\n" +
            "       CAST(b.intransit_qty AS CHAR) AS intransit_qty,\n" +
            "       CAST(b.balance_quantity AS CHAR) AS balance_quantity,\n" +
            "       DATE_FORMAT(b.manufacturing_date, '%Y-%m-%d %H:%i:%s') AS manufacturing_date,\n" +
            "       DATE_FORMAT(b.expired_date, '%Y-%m-%d %H:%i:%s') AS expired_date,\n" +
            "       b.remark, b.remark2, b.remark3\n" +
            "  FROM item_batch_balance b\n" +
            " WHERE b.tenant_id = ?\n" +
            "   AND b.organization_id = ?\n" +
            "   AND b.is_deleted = 0\n" +
            "   AND (b.material_id, b.location_id, b.batch_id, b.plant_id) IN (SELECT jt.m, jt.l, jt.b, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]', b BIGINT PATH '$[2]', p BIGINT PATH '$[3]')) jt)", params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.batchTuplesJson], outputs: { id: { type: 'string', title: 'id' }, material_id: { type: 'string', title: 'material_id' }, location_id: { type: 'string', title: 'location_id' }, batch_id: { type: 'string', title: 'batch_id' }, plant_id: { type: 'string', title: 'plant_id' }, organization_id: { type: 'string', title: 'organization_id' }, unrestricted_qty: { type: 'string', title: 'unrestricted_qty' }, reserved_qty: { type: 'string', title: 'reserved_qty' }, block_qty: { type: 'string', title: 'block_qty' }, qualityinsp_qty: { type: 'string', title: 'qualityinsp_qty' }, intransit_qty: { type: 'string', title: 'intransit_qty' }, balance_quantity: { type: 'string', title: 'balance_quantity' }, manufacturing_date: { type: 'string', title: 'manufacturing_date' }, expired_date: { type: 'string', title: 'expired_date' }, remark: { type: 'string', title: 'remark' }, remark2: { type: 'string', title: 'remark2' }, remark3: { type: 'string', title: 'remark3' } } });
          })
          .branch('FIFO', async () => {
            /* @id sql_node_IBfifoB */ const sql_node_IBfifoB = await sql('Read-back: FIFO layers', { table: t.FIFO_Costing_History, sql: "SELECT CAST(f.id AS CHAR) AS id, CAST(f.material_id AS CHAR) AS material_id, CAST(f.plant_id AS CHAR) AS plant_id,\n" +
            "       f.organization_id, CAST(COALESCE(f.batch_id, 0) AS CHAR) AS batch_id, f.fifo_sequence,\n" +
            "       CAST(f.fifo_cost_price AS CHAR) AS fifo_cost_price, CAST(f.fifo_initial_quantity AS CHAR) AS fifo_initial_quantity,\n" +
            "       CAST(f.fifo_available_quantity AS CHAR) AS fifo_available_quantity\n" +
            "  FROM fifo_costing_history f\n" +
            " WHERE f.tenant_id = ?\n" +
            "   AND f.organization_id = ?\n" +
            "   AND f.is_deleted = 0\n" +
            "   AND (f.material_id, f.plant_id) IN (SELECT jt.m, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', p BIGINT PATH '$[1]')) jt)\n" +
            " ORDER BY f.id", params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.costPairsJson], outputs: { id: { type: 'string', title: 'id' }, material_id: { type: 'string', title: 'material_id' }, plant_id: { type: 'string', title: 'plant_id' }, organization_id: { type: 'string', title: 'organization_id' }, batch_id: { type: 'string', title: 'batch_id' }, fifo_sequence: { type: 'string', title: 'fifo_sequence' }, fifo_cost_price: { type: 'string', title: 'fifo_cost_price' }, fifo_initial_quantity: { type: 'string', title: 'fifo_initial_quantity' }, fifo_available_quantity: { type: 'string', title: 'fifo_available_quantity' } } });
          })
          .branch('WA', async () => {
            /* @id sql_node_IBwaB */ const sql_node_IBwaB = await sql('Read-back: Weighted Average rows', { table: t.Weighted_Average_Costing_History, sql: "SELECT CAST(w.id AS CHAR) AS id, CAST(w.material_id AS CHAR) AS material_id, w.plant_id, w.organization_id,\n" +
            "       CAST(COALESCE(w.batch_id, 0) AS CHAR) AS batch_id, CAST(w.wa_quantity AS CHAR) AS wa_quantity,\n" +
            "       CAST(w.wa_cost_price AS CHAR) AS wa_cost_price, w.created_at\n" +
            "  FROM wa_costing_method w\n" +
            " WHERE w.tenant_id = ?\n" +
            "   AND w.organization_id = ?\n" +
            "   AND w.is_deleted = 0\n" +
            "   AND (w.material_id, w.plant_id) IN (SELECT jt.m, jt.p FROM JSON_TABLE(?, '$[*]' COLUMNS (m BIGINT PATH '$[0]', p BIGINT PATH '$[1]')) jt)\n" +
            " ORDER BY w.id", params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.costPairsJson], outputs: { id: { type: 'string', title: 'id' }, material_id: { type: 'string', title: 'material_id' }, plant_id: { type: 'string', title: 'plant_id' }, organization_id: { type: 'string', title: 'organization_id' }, batch_id: { type: 'string', title: 'batch_id' }, wa_quantity: { type: 'string', title: 'wa_quantity' }, wa_cost_price: { type: 'string', title: 'wa_cost_price' }, created_at: { type: 'string', title: 'created_at' } } });
          })
          .branch('Movements', async () => {
            /* @id sql_node_IBmvB */ const sql_node_IBmvB = await sql('Read-back: inventory_movement of this operation', { table: t.Inventory_Movement, sql: "SELECT m.operation_effect_key\n" +
            "  FROM inventory_movement m\n" +
            " WHERE m.tenant_id = ?\n" +
            "   AND m.operation_effect_key IN (SELECT jt.k FROM JSON_TABLE(?, '$[*]' COLUMNS (k VARCHAR(255) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) jt)\n" +
            "   AND m.is_deleted = 0", params: [code_node_IBguard.tenantId, code_node_IBguard.effectKeysJson], outputs: { operation_effect_key: { type: 'string', title: 'operation_effect_key' } } });
          });
        /* @id code_node_IBverify */ const code_node_IBverify = await code('Verify: planned values, new rows, one movement per key', "// INVENTORY_BULK_APPLY read-back: every planned row holds its after-values, every new row exists, every movement is there once\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));\nconst arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);\nconst expect = [{{node:code_node_IBplan.data.expect}}][0] || {};\nconst creates = [{{node:code_node_IBplan.data.expectCreates}}][0] || [];\nconst reads = {\n  item_balance: arr([{{node:sql_node_IBbalB.data}}][0]),\n  item_batch_balance: arr([{{node:sql_node_IBbatchB.data}}][0]),\n  fifo: arr([{{node:sql_node_IBfifoB.data}}][0]),\n  wa: arr([{{node:sql_node_IBwaB.data}}][0]),\n};\nconst mvRows = arr([{{node:sql_node_IBmvB.data}}][0]);\nconst bad = [];\nconst same = (row, want) => {\n  for (const c of Object.keys(want || {})) {\n    const a = want[c];\n    if (c.indexOf(\"remark\") === 0 || a === null || a === \"\" || isNaN(Number(a))) {\n      if (s(a) !== s(row[c])) return false;\n    } else if (Math.abs(q8(a) - q8(row[c])) > 1e-8) return false;\n  }\n  return true;\n};\nfor (const t of Object.keys(reads)) {\n  const byId = {};\n  for (const r of reads[t]) byId[s(r.id)] = r;\n  for (const pair of arr(expect[t])) {\n    const row = byId[s(pair[0])];\n    if (!row) bad.push(t + \" \" + pair[0] + \" missing\");\n    else if (!same(row, pair[1])) bad.push(t + \" \" + pair[0] + \" does not hold the planned values\");\n  }\n}\nfor (const c of creates) {\n  const rows = reads[c.table] || [];\n  const norm = (k, v) => (k === \"batch_id\" && (v === null || v === undefined || s(v) === \"0\") ? \"\" : s(v));\n  const hit = rows.some((r) => Object.keys(c.key).every((k) => norm(k, r[k]) === norm(k, c.key[k])) && same(r, c.values));\n  if (!hit) bad.push(c.table + \" new row \" + JSON.stringify(c.key) + \" missing\");\n}\nconst seen = {};\nlet dup = 0;\nfor (const r of mvRows) {\n  const k = s(r.operation_effect_key);\n  if (seen[k]) dup++;\n  seen[k] = true;\n}\nconst want = Number(expect.movements || 0);\nif (Object.keys(seen).length !== want) bad.push(\"movements: \" + Object.keys(seen).length + \" of \" + want);\nif (dup) bad.push(\"movements: \" + dup + \" duplicated\");\nreturn { route: bad.length ? \"REVIEW\" : \"DONE\", problems: bad.slice(0, 15).join(\"; \"), problemCount: String(bad.length) };\n", {
          outputs: {
            route: { type: 'string', title: 'route' },
            problems: { type: 'string', title: 'problems' },
            problemCount: { type: 'string', title: 'problemCount' },
          },
        });
        /* @id code_node_IBdone */ const code_node_IBdone = await code('Step row: IBA|DONE (the answer a repeat returns) or IBA|REVIEW', "// INVENTORY_BULK_APPLY step rows: IBA|DONE carries the per-movement answer a repeat call returns; IBA|REVIEW the reason\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst op = s([{{node:code_node_IBguard.data.operationKey}}][0]);\nconst org = s([{{node:code_node_IBguard.data.organizationId}}][0]);\nconst verify = [{{node:code_node_IBverify.data}}][0] || {};\nconst plan = [{{node:code_node_IBplan.data}}][0] || {};\nconst ok = s(verify.route) === \"DONE\";\nconst row = ok\n  ? { job_id: op, organization_id: org, step_name: \"IBA|DONE\", step_status: \"DONE\", attempt_count: 0, result_ref: JSON.stringify({ results: plan.results || [], summary: plan.summary || {} }) }\n  : { job_id: op, organization_id: org, step_name: \"IBA|REVIEW\", step_status: \"REVIEW\", attempt_count: 0, error_code: \"READBACK\", error_message: s(verify.problems) };\nreturn { rows: [row], ok: ok ? \"YES\" : \"NO\" };\n", {
          outputs: {
            rows: { type: 'array', title: 'rows', items: 'any' },
            ok: { type: 'string', title: 'ok' },
          },
        });
        /* @id add_node_IBdone */ await add('IBA|DONE / IBA|REVIEW', {
          props: {
            job_id: code_node_IBdone.rows.job_id,
            organization_id: code_node_IBdone.rows.organization_id,
            step_name: code_node_IBdone.rows.step_name,
            step_status: code_node_IBdone.rows.step_status,
            attempt_count: code_node_IBdone.rows.attempt_count,
            result_ref: code_node_IBdone.rows.result_ref,
            error_code: code_node_IBdone.rows.error_code,
            error_message: code_node_IBdone.rows.error_message,
          },
          table: t.GD_Publish_Step,
        });
      })
      .case('REVIEW', rule({ field: code_node_IBplan.route, op: 'equal', value: 'REVIEW' }), async () => {
        /* @id add_node_IBrev */ await add('IBA|REVIEW: rows changed under a stored plan (locks are kept)', {
          props: {
            job_id: code_node_IBguard.operationKey,
            organization_id: code_node_IBguard.organizationId,
            step_name: 'IBA|REVIEW',
            step_status: 'REVIEW',
            attempt_count: 0,
            error_code: code_node_IBplan.result_code,
            error_message: code_node_IBplan.result_message,
          },
          table: t.GD_Publish_Step,
        });
      })
      .default('NO', async () => {});
    /* @id code_node_IBend */ const code_node_IBend = await code('End: the answer, and whether the locks go back', "// INVENTORY_BULK_APPLY end: the answer of this run, and whether the locks go back (kept on REVIEW, as INVENTORY_APPLY_OPERATION does)\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst mode = s([{{node:code_node_IBguard.data.mode}}][0]);\nconst plan = [{{node:code_node_IBplan.data}}][0] || {};\nconst verify = [{{node:code_node_IBverify.data}}][0] || {};\nconst route = s(plan.route);\nlet out;\nif (route === \"WRITE\") {\n  out = s(verify.route) === \"DONE\"\n    ? { code: \"200\", result_code: \"OK\", message: \"Applied \" + ((plan.summary || {}).movements || 0) + \" movements\", release: \"YES\" }\n    : { code: \"500\", result_code: \"REQUIRES_REVIEW\", message: s(verify.problems), release: \"NO\" };\n} else if (route === \"FAIL\") {\n  out = { code: \"400\", result_code: s(plan.result_code), message: s(plan.result_message), release: \"YES\" };\n} else if (route === \"LOST\") {\n  out = { code: \"409\", result_code: \"LOCK_BUSY\", message: s(plan.result_message), release: \"YES\" };\n} else {\n  out = { code: \"500\", result_code: \"REQUIRES_REVIEW\", message: s(plan.result_message), release: \"NO\" };\n}\nif (mode !== \"APPLY\") out.release = \"NO\";\nreturn Object.assign(out, { results: plan.results || [], summary: plan.summary || {} });\n", {
      outputs: {
        code: { type: 'string', title: 'code' },
        result_code: { type: 'string', title: 'result_code' },
        message: { type: 'string', title: 'message' },
        results: { type: 'array', title: 'results', items: 'any' },
        summary: { type: 'any', title: 'summary' },
        release: { type: 'string', title: 'release' },
      },
    });
    /* @id cor_IBrelease */ switchFirst('Give the locks back?')
      .case('YES', rule({ field: code_node_IBend.release, op: 'equal', value: 'YES' }), async () => {
        /* @id sql_node_IBrel */ const sql_node_IBrel = await sql('Lock release: the lock rows of the keys', { table: t.Inventory_Balance_Lock,
          sql:
            'SELECT CAST(id AS CHAR) AS id, lock_key, free_token, owner_operation_id, lock_version,\n' +
            "       DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now\n" +
            '  FROM inventory_balance_lock\n' +
            ' WHERE tenant_id = ?\n' +
            '   AND organization_id = ?\n' +
            '   AND lock_key IN (SELECT jt.k FROM JSON_TABLE(?, \'$[*]\' COLUMNS (k VARCHAR(128) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH \'$\')) jt)\n' +
            '   AND is_deleted = 0',
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.lockKeysJson],
          outputs: {
            id: { type: 'string', title: 'id' },
            lock_key: { type: 'string', title: 'lock_key' },
            free_token: { type: 'int', title: 'free_token' },
            owner_operation_id: { type: 'string', title: 'owner_operation_id' },
            lock_version: { type: 'int', title: 'lock_version' },
            db_now: { type: 'string', title: 'db_now' },
          },
        });
        /* @id code_node_IBrelease */ const code_node_IBrelease = await code('Lock release plan: this operation only', "// INVENTORY_BULK_APPLY lock release plan: this operation's rows only (owner cleared first, then GIVE adds the token back)\nconst s = (v) => (v === undefined || v === null ? \"\" : String(v));\nconst op = s([{{node:code_node_IBguard.data.operationKey}}][0]);\nconst rows = [{{node:sql_node_IBrel.data}}][0];\nconst list = Array.isArray(rows) ? rows : rows ? [rows] : [];\nlet dbNow = \"\";\nfor (const r of list) if (r && !dbNow && r.db_now) dbNow = s(r.db_now);\nconst clearRows = [];\nfor (const r of list) {\n  if (!r || s(r.owner_operation_id) !== op || !/^[0-9]{1,20}$/.test(s(r.id))) continue;\n  if (Number(r.free_token) !== 0) continue;\n  clearRows.push({ id: s(r.id), owner_operation_id: \"\", last_owner_operation_id: op, last_released_at: dbNow, lock_version: (Number(r.lock_version) || 0) + 1 });\n}\nconst batches = [];\nfor (let i = 0; i < clearRows.length; i += 250) batches.push({ from: i });\nreturn { clearRows: clearRows, batches: batches, plusIds: clearRows.map((r) => r.id), needRelease: clearRows.length ? \"YES\" : \"NO\" };\n", {
          outputs: {
            clearRows: { type: 'array', title: 'clearRows', items: 'any' },
            batches: { type: 'array', title: 'batches', items: 'any' },
            plusIds: { type: 'array', title: 'plusIds', items: 'any' },
            needRelease: { type: 'string', title: 'needRelease' },
          },
        });
        /* @id cor_IBrel2 */ switchFirst('Anything held?')
          .case('YES', rule({ field: code_node_IBrelease.needRelease, op: 'equal', value: 'YES' }), async () => {
            /* @id set_cache_IBrlIdx0 */ const set_cache_IBrlIdx0 = await setCache("Release slice index = 0 (per run: the key carries the run's nonce)", {
              key: 'iba_rl_{{node:code_node_IBguard.data.nonce}}',
              value: '0', ttl: 3600000,
            });
            /* @id loop_IBrel @title "Clear the owner, in slices of <= 250" */ for (const _item of code_node_IBrelease.batches) {
              /* @id get_cache_IBrlIdx */ const get_cache_IBrlIdx = await getCache('Release slice index', { key: 'iba_rl_{{node:code_node_IBguard.data.nonce}}' });
              /* @id code_node_IBrlSlice */ const code_node_IBrlSlice = await code('Release slice', "// INVENTORY_BULK_APPLY slice of clearRows: rows [index * 250, + 250)\nconst all = [{{node:code_node_IBrelease.data.clearRows}}][0];\nconst list = Array.isArray(all) ? all : all ? [all] : [];\nconst raw = [{{node:get_cache_IBrlIdx.data}}][0];\nconst index = raw === undefined || raw === null || String(raw).trim() === \"\" ? 0 : parseInt(String(raw).replace(/\"/g, \"\"), 10) || 0;\nconst rows = list.slice(index * 250, index * 250 + 250);\nreturn { rows: rows, count: String(rows.length), nextIndex: String(index + 1) };\n", {
                outputs: {
                  rows: { type: 'array', title: 'rows', items: 'any' },
                  count: { type: 'string', title: 'count' },
                  nextIndex: { type: 'string', title: 'nextIndex' },
                },
              });
              /* @id update_node_IBrel */ const update_node_IBrel = await update('Lock release step 1: owner cleared, last owner = this operation', {
                props: {
                  id: code_node_IBrlSlice.rows.id,
                  owner_operation_id: code_node_IBrlSlice.rows.owner_operation_id,
                  last_owner_operation_id: code_node_IBrlSlice.rows.last_owner_operation_id,
                  last_released_at: code_node_IBrlSlice.rows.last_released_at,
                  lock_version: code_node_IBrlSlice.rows.lock_version,
                },
                table: t.Inventory_Balance_Lock,
                where: { field: 'id', op: 'in', value: code_node_IBrlSlice.rows.id, valueType: 'field' },
              });
              /* @id set_cache_IBrlIdxN */ const set_cache_IBrlIdxN = await setCache('Next release slice index', {
                key: 'iba_rl_{{node:code_node_IBguard.data.nonce}}',
                value: code_node_IBrlSlice.nextIndex, ttl: 3600000,
              });
            }
            /* @id workflow_node_IBgive */ const workflow_node_IBgive = await callWorkflow('Lock release step 2: INVENTORY_LOCK_TOKENS GIVE', {
              inputs: {
                mode: 'GIVE',
                operation_id: code_node_IBguard.operationKey,
                organization_id: code_node_IBguard.organizationId,
                claimed_at: '',
                ids: code_node_IBrelease.plusIds,
              },
              use: workflows.INVENTORY_LOCK_TOKENS,
            });
          })
          .default('NO', async () => {});
      })
      .default('NO', async () => {});
    /* @id return_node_IBend */ return {
      status: 200,
      code: code_node_IBend.code,
      result_code: code_node_IBend.result_code,
      message: code_node_IBend.message,
      results: code_node_IBend.results,
      summary: code_node_IBend.summary,
    };
  },
);
