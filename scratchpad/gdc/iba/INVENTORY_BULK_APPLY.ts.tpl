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
    const code_node_IBguard = await code('Guard: request, session tenant, the lists every read binds', CODE('guard.js'), {
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
    const sql_node_IBops = await sql("This operation's step rows (DONE / REVIEW / intent)", { table: t.GD_Publish_Step,
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
    const code_node_IBstate = await code('State: replay a DONE answer, stop on REVIEW, resume a stored intent, or start', CODE('state.js'), {
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
      const sql_node_IBlk1 = await sql('Lock seed: the lock rows of the keys', { table: t.Inventory_Balance_Lock,
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
      const code_node_IBseed = await code('Lock seed: the missing rows (free_token 1)', CODE('lock_seed.js'), {
        outputs: {
          rowsToAdd: { type: 'array', title: 'rowsToAdd', items: 'any' },
          batches: { type: 'array', title: 'batches', items: 'any' },
          needSeed: { type: 'string', title: 'needSeed' },
        },
      });
      /* @id cor_IBseed */ switchFirst('Lock rows to seed?')
        .case('YES', rule({ field: code_node_IBseed.needSeed, op: 'equal', value: 'YES' }), async () => {
          const set_cache_IBsdIdx0 = await setCache("Seed slice index = 0 (per run: the key carries the run's nonce)", {
            key: 'iba_sd_{{node:code_node_IBguard.data.nonce}}',
            value: '0', ttl: 3600000,
          });
          /* @id loop_IBseed @title "Seed the lock rows in slices of <= 250" */ for (const _item of code_node_IBseed.batches) {
            const get_cache_IBsdIdx = await getCache('Seed slice index', { key: 'iba_sd_{{node:code_node_IBguard.data.nonce}}' });
            const code_node_IBsdSlice = await code('Seed slice', CODE('slice.tpl.js', {'__LIST__': 'rowsToAdd', '__SRC__': 'code_node_IBseed', '__IDX__': 'get_cache_IBsdIdx'}), {
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
            const set_cache_IBsdIdxN = await setCache('Next seed slice index', {
              key: 'iba_sd_{{node:code_node_IBguard.data.nonce}}',
              value: code_node_IBsdSlice.nextIndex, ttl: 3600000,
            });
          }
        })
        .default('NO', async () => {});
      const sql_node_IBlk2 = await sql('Lock claim: the lock rows before the take', { table: t.Inventory_Balance_Lock,
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
      const code_node_IBclaim = await code('Lock claim: BUSY / TAKE / HELD', CODE('lock_claim.js'), {
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
          const workflow_node_IBtake = await callWorkflow('Lock take: INVENTORY_LOCK_TOKENS TAKE, in lock order', {
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
      const sql_node_IBlk3 = await sql('Lock verify: the lock rows after the take', { table: t.Inventory_Balance_Lock,
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
      const code_node_IBlkv = await code('Lock verify: every key held by this operation, else LOST', CODE('lock_verify.js'), {
        outputs: {
          route: { type: 'string', title: 'route' },
          lost: { type: 'string', title: 'lost' },
          lostCount: { type: 'string', title: 'lostCount' },
        },
      });
    }
    /* @id cond_all_IBread */ parallel('Reads (under the locks on APPLY)')
      .branch('Items', async () => {
        const sql_node_IBitems = await sql('Items: costing method, stock control, base unit, unit conversions', { table: t.Item,
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
        const sql_node_IBbal = await sql('item_balance rows of the movements', { table: t.Item_Balance,
          sql: BAL_SQL,
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.balTuplesJson],
          outputs: BAL_OUT,
        });
      })
      .branch('Batch balances', async () => {
        const sql_node_IBbatch = await sql('item_batch_balance rows of the movements', { table: t.Item_Batch_Balance,
          sql: BATCH_SQL,
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.batchTuplesJson],
          outputs: BATCH_OUT,
        });
      })
      .branch('FIFO', async () => {
        const sql_node_IBfifo = await sql('FIFO layers of the materials and plants (every batch)', { table: t.FIFO_Costing_History,
          sql: FIFO_SQL,
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.costPairsJson],
          outputs: FIFO_OUT,
        });
      })
      .branch('WA', async () => {
        const sql_node_IBwa = await sql('Weighted Average rows of the materials and plants (every batch)', { table: t.Weighted_Average_Costing_History,
          sql: WA_SQL,
          params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.costPairsJson],
          outputs: WA_OUT,
        });
      })
      .branch('Movements already written', rule({ field: code_node_IBstate.route, op: 'equal', value: 'RESUME' }), async () => {
        const sql_node_IBmv = await sql('inventory_movement rows of this operation (a resumed run adds only the missing ones)', { table: t.Inventory_Movement,
          sql: MV_SQL,
          params: [code_node_IBguard.tenantId, code_node_IBguard.effectKeysJson],
          outputs: MV_OUT,
        });
      });
    const code_node_IBplan = await code('Plan: replay the movements (or compare the stored intent) -> rows to write', CODE('plan.js'), {
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
        code: CODE_OF_PLAN,
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
WRITE_LOOPS
        /* @id cond_all_IBback */ parallel('Read-back')
          .branch('Balances', async () => {
            const sql_node_IBbalB = await sql('Read-back: item_balance', { table: t.Item_Balance, sql: BAL_SQL, params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.balTuplesJson], outputs: BAL_OUT });
          })
          .branch('Batch balances', async () => {
            const sql_node_IBbatchB = await sql('Read-back: item_batch_balance', { table: t.Item_Batch_Balance, sql: BATCH_SQL, params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.batchTuplesJson], outputs: BATCH_OUT });
          })
          .branch('FIFO', async () => {
            const sql_node_IBfifoB = await sql('Read-back: FIFO layers', { table: t.FIFO_Costing_History, sql: FIFO_SQL, params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.costPairsJson], outputs: FIFO_OUT });
          })
          .branch('WA', async () => {
            const sql_node_IBwaB = await sql('Read-back: Weighted Average rows', { table: t.Weighted_Average_Costing_History, sql: WA_SQL, params: [code_node_IBguard.tenantId, code_node_IBguard.organizationId, code_node_IBguard.costPairsJson], outputs: WA_OUT });
          })
          .branch('Movements', async () => {
            const sql_node_IBmvB = await sql('Read-back: inventory_movement of this operation', { table: t.Inventory_Movement, sql: MV_SQL, params: [code_node_IBguard.tenantId, code_node_IBguard.effectKeysJson], outputs: MV_OUT });
          });
        const code_node_IBverify = await code('Verify: planned values, new rows, one movement per key', CODE('verify.js'), {
          outputs: {
            route: { type: 'string', title: 'route' },
            problems: { type: 'string', title: 'problems' },
            problemCount: { type: 'string', title: 'problemCount' },
          },
        });
        const code_node_IBdone = await code('Step row: IBA|DONE (the answer a repeat returns) or IBA|REVIEW', CODE('done_row.js'), {
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
    const code_node_IBend = await code('End: the answer, and whether the locks go back', CODE('end.js'), {
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
        const sql_node_IBrel = await sql('Lock release: the lock rows of the keys', { table: t.Inventory_Balance_Lock,
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
        const code_node_IBrelease = await code('Lock release plan: this operation only', CODE('release.js'), {
          outputs: {
            clearRows: { type: 'array', title: 'clearRows', items: 'any' },
            batches: { type: 'array', title: 'batches', items: 'any' },
            plusIds: { type: 'array', title: 'plusIds', items: 'any' },
            needRelease: { type: 'string', title: 'needRelease' },
          },
        });
        /* @id cor_IBrel2 */ switchFirst('Anything held?')
          .case('YES', rule({ field: code_node_IBrelease.needRelease, op: 'equal', value: 'YES' }), async () => {
            const set_cache_IBrlIdx0 = await setCache("Release slice index = 0 (per run: the key carries the run's nonce)", {
              key: 'iba_rl_{{node:code_node_IBguard.data.nonce}}',
              value: '0', ttl: 3600000,
            });
            /* @id loop_IBrel @title "Clear the owner, in slices of <= 250" */ for (const _item of code_node_IBrelease.batches) {
              const get_cache_IBrlIdx = await getCache('Release slice index', { key: 'iba_rl_{{node:code_node_IBguard.data.nonce}}' });
              const code_node_IBrlSlice = await code('Release slice', CODE('slice.tpl.js', {'__LIST__': 'clearRows', '__SRC__': 'code_node_IBrelease', '__IDX__': 'get_cache_IBrlIdx'}), {
                outputs: {
                  rows: { type: 'array', title: 'rows', items: 'any' },
                  count: { type: 'string', title: 'count' },
                  nextIndex: { type: 'string', title: 'nextIndex' },
                },
              });
              const update_node_IBrel = await update('Lock release step 1: owner cleared, last owner = this operation', {
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
              const set_cache_IBrlIdxN = await setCache('Next release slice index', {
                key: 'iba_rl_{{node:code_node_IBguard.data.nonce}}',
                value: code_node_IBrlSlice.nextIndex, ttl: 3600000,
              });
            }
            const workflow_node_IBgive = await callWorkflow('Lock release step 2: INVENTORY_LOCK_TOKENS GIVE', {
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
