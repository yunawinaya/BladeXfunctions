# BUG-20261012-017 — GD line stamp demoted picked lines

**Deployed.** Prod v175 and dev v240 (2026-10-13) both contain the fix (`if_StampGDLines` plus the
`code_node_o35eZx2c` status filter). `repairs/R1_restore_gd_line_picking_status.sql` has run: all 19 lines
read Completed.

**Do NOT paste `GOODS_DELIVERY.prod.json`.** It was built from prod v173. Prod has since moved on
(the `if_SoLineGone` / `code_node_QtyCheckBatch` change), and that file would remove it. The source of truth is
`Goods Delivery/GDheadWorkflow.json`.
