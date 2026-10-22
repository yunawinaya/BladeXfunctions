SELECT CAST(l.id AS CHAR) AS id,
       CONCAT_WS(',',
         IF(l.`item_name` = '', 'item_name', NULL),
         IF(l.`item_id` = '', 'item_id', NULL),
         IF(l.`so_desc` = '', 'so_desc', NULL),
         IF(l.`more_desc` = '', 'more_desc', NULL),
         IF(l.`further_description` = '', 'further_description', NULL),
         IF(l.`so_discount_uom` = '', 'so_discount_uom', NULL),
         IF(l.`so_packaging_style` = '', 'so_packaging_style', NULL),
         IF(l.`line_remark_1` = '', 'line_remark_1', NULL),
         IF(l.`line_remark_2` = '', 'line_remark_2', NULL),
         IF(l.`line_remark_3` = '', 'line_remark_3', NULL),
         IF(l.`sqt_line_id` = '', 'sqt_line_id', NULL),
         IF(l.`line_index` = '', 'line_index', NULL),
         IF(l.`organization_id` = '', 'organization_id', NULL),
         IF(l.`line_status` = '', 'line_status', NULL),
         IF(l.`source_po_line_item_id` = '', 'source_po_line_item_id', NULL),
         IF(l.`table_uom_conversion` = '', 'table_uom_conversion', NULL)) AS blanks
  FROM sales_order_axszx8cj_sub l
 WHERE l.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND l.is_deleted = 0
   AND l.sales_order_id = {{node:code_node_SCgate.data.soIdSql}}