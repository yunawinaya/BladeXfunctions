SELECT CAST(p.id AS CHAR) AS id,
       p.purchase_order_no,
       p.po_status,
       CAST(p.po_plant AS CHAR) AS po_plant,
       p.organization_id,
       p.po_supplier_id,
       (SELECT JSON_ARRAYAGG(j.v) FROM JSON_TABLE(p.preq_id, '$[*]' COLUMNS (v VARCHAR(40) PATH '$')) j) AS preq_id_json,
       CAST(p.po_total AS CHAR) AS po_total,
       p.auto_pi,
       p.create_pi
  FROM purchase_order p
 WHERE p.tenant_id = '{{system:tenantId}}'
   AND p.id = {{node:code_get_latest.data.poIdSql}}
   AND p.is_deleted = 0
