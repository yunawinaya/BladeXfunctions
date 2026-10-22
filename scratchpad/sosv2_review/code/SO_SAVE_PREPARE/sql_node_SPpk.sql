SELECT CAST(i.id AS CHAR) AS id,
       CAST(i.net_weight AS CHAR) AS net_weight,
       COALESCE(pd.packing_detail_json, '[]') AS packing_detail_json,
       COALESCE((
           SELECT JSON_ARRAYAGG(JSON_OBJECT(
                      'alt_uom_id', CAST(u.alt_uom_id AS CHAR),
                      'base_qty', u.base_qty))
           FROM item_mji552rc_sub u
           WHERE u.Item_id = i.id
             AND u.is_deleted = 0
       ), '[]') AS uom_conversion_json
  FROM (SELECT DISTINCT sl.mid FROM (SELECT CAST(jt.item AS UNSIGNED) AS mid
          FROM gd_publish_step r
          JOIN JSON_TABLE(r.result_ref, '$[*]' COLUMNS (item VARCHAR(64) PATH '$.item_name')) jt
         WHERE r.tenant_id = '{{node:code_node_SPguard.data.tenantId}}' AND r.is_deleted = 0 AND r.step_status = 'PART' AND r.job_id = 'SOR|{{node:code_node_SPgate.data.requestNonce}}'
           AND r.step_name LIKE 'R|%' AND r.step_name <> 'R|000' AND jt.item REGEXP '^[0-9]+$') sl) sel
  JOIN (SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(h.result_ref, '$.created_source')), 'null'), '') AS src,
               COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(h.result_ref, '$.organization_id')), 'null'), '') AS org
          FROM gd_publish_step h
         WHERE h.tenant_id = '{{node:code_node_SPguard.data.tenantId}}' AND h.is_deleted = 0 AND h.step_status = 'PART' AND h.job_id = 'SOR|{{node:code_node_SPgate.data.requestNonce}}' AND h.step_name = 'R|000') hd
    ON hd.src NOT IN ('Web', 'Mobile', 'Internal Trading')
  JOIN item i
    ON i.id = sel.mid
   AND i.is_deleted = 0
   AND (TRIM(hd.org) = '' OR i.organization_id = (CASE WHEN TRIM(hd.org) REGEXP '^[0-9]+$' THEN TRIM(hd.org) ELSE '0' END))
  LEFT JOIN (
    SELECT p.Item_id AS iid,
           JSON_ARRAYAGG(JSON_OBJECT(
               'uom_id', CAST(p.uom_id AS CHAR),
               'quantity', p.quantity,
               'packing_uom_id', CAST(p.packing_uom_id AS CHAR))) AS packing_detail_json
    FROM item_vabbbwt2_sub p
    WHERE p.is_deleted = 0
      AND p.Item_id IN (SELECT s2.mid FROM (SELECT CAST(jt2.item AS UNSIGNED) AS mid
          FROM gd_publish_step r2
          JOIN JSON_TABLE(r2.result_ref, '$[*]' COLUMNS (item VARCHAR(64) PATH '$.item_name')) jt2
         WHERE r2.tenant_id = '{{node:code_node_SPguard.data.tenantId}}' AND r2.is_deleted = 0 AND r2.step_status = 'PART' AND r2.job_id = 'SOR|{{node:code_node_SPgate.data.requestNonce}}'
           AND r2.step_name LIKE 'R|%' AND r2.step_name <> 'R|000' AND jt2.item REGEXP '^[0-9]+$') s2)
    GROUP BY p.Item_id
  ) pd ON pd.iid = i.id