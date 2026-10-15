SELECT u.kind, u.doc_no
  FROM ((SELECT 'GR' AS kind, g.gr_no AS doc_no
           FROM goods_receiving g
          WHERE g.tenant_id = '{{system:tenantId}}'
            AND g.is_deleted = 0
            AND g.gr_status = 'Draft'
            AND (JSON_CONTAINS(g.po_id, '{{node:code_pre.data.poIdSql}}') OR JSON_CONTAINS(g.po_id, JSON_QUOTE('{{node:code_pre.data.poIdSql}}')))
          ORDER BY g.id
          LIMIT 100)
        UNION ALL
        (SELECT 'PI' AS kind, p.purchase_invoice_no AS doc_no
           FROM purchase_invoice p
          WHERE p.tenant_id = '{{system:tenantId}}'
            AND p.is_deleted = 0
            AND p.pi_status = 'Draft'
            AND (JSON_CONTAINS(p.po_id, '{{node:code_pre.data.poIdSql}}') OR JSON_CONTAINS(p.po_id, JSON_QUOTE('{{node:code_pre.data.poIdSql}}')))
          ORDER BY p.id
          LIMIT 100)) u
