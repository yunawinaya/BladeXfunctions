Location Transfer V2: publishing to DEV at ~17:30 today (user approved), from bladexfunctions-f8. Exact list:
- SM_LOCATION_TRANSFER (2013133675374927874): deployed v82 + guard nodes only. A save of a stored "Processing" LOT, or a
  non-Draft save of more than 500 lines, is refused with 400 before any write. Mobile and web use the same classic workflow.
- NEW: LOT_V2_SUBMIT 2110992282596540417, LOT_V2_WORKER 2110992316335521793, LOT_V2_PREPARE 2110992359150977026,
  LOT_V2_COMMIT 2110992400045441026.
- LOT form (sm_location_transfer, dev v107 -> next): new status option "Processing", hidden lot_v2_job_id + lot_idem_key
  (columns created by the form publish), a Processing badge, and the 3 save buttons go through lotV2_onClick_save.
  Saves of 50 lines or fewer, and anything not eligible, fall through to the unchanged classic handlers.
- LOT list page 2013863255693197313 (v47 -> next): worker kick on mount, Processing badge, Cancel V2 route for big LOTs.
- Shared machinery used UNCHANGED: INVENTORY_BULK_APPLY, gd_async_job / gd_publish_step, in_transit_detail.
  Namespaces: command SAVE_LOT, correlation LOT|<id>, gd_id/gd_no empty, lock SMLT|<lotId>/LOCK|n, engine op SMLT|<jobId>.
- Ships in next week's full deployment as-is.
