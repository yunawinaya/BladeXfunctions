# 2026-10-30 Kenhin SO-1026-1162: Convert to GD refused, "sales order not found"

**Status:** repair.sql RUN by the user. Kenhin converted again at 15:48: GD/20261030/2370. The SO is now Completed.

## What happened
- **15:32:46:** the SO list's convert queued GD Created V2 job 2116070794726608898 for SO-1026-1162. PREPARE (GD_BULK_PREPARE v23) failed it: GD_INVALID_DATA "sales order 2116048711493750785 not found". Nothing was written. The batch's 4 other SOs converted (SO-1026-1160 / 1161 / 1163 / 1164 -> GD/20261030/2356-2359).
- **The SO existed** (Issued, not deleted). PREPARE reads sales orders by tenant + the delivery's organization + id (`sql_node_fOZs0RT8`), and this SO's `organization_id` was **empty**.
- **The only such SO:** it is the only live SO on prod without an organization since 10-01. The SO's line kept the organization, and no other field was lost.

## Which workflow: none of them wrote the empty organization
The SO's path: classic **SO_SAVE** (1988908545345945602, prod v91) run 2116048709547593729, by the creator at 14:05:01.
1. **Insert (14:05:01):** `add_node_ji9E0C1S` inserted DRAFT-SO-0197. Its output shows `organization_id` 2006752085806436353, so the SO was created correctly.
2. **Approval wait:** the credit check answered "Override - Overdue Limit" with approval needed. SO_SAVE then waited at its approval slot `slot_node_ehX7sDpE` for 70 minutes.
   - The slot is the "SO Approval" workflow (2108380199392514049 v5), Flowable process d865d06c-d427-11f1-b71a-5ae8f9deb987.
   - SO Approval writes nothing to the SO; it only sends push notifications (Push_Notification_v2).
   - Its approval page shows 76 fields, all read-only, and `organization_id` is not one of them.
3. **Approval pass (15:15:02):** user 2011713052998049793 passed it (comment "yap") after opening it at 15:14:33. SO_SAVE resumed and ran:
   - `update_node_FBCZlcO2`: writes `so_no` ('issued', so the number rule gave SO-1026-1162) and `so_status` only;
   - `update_node_SOLnIssu`: the lines' `line_status`.
   - That was the SO's last write before the convert (15:15:04.640, by the approver).
- **Ruled out:**
  - SO_SAVE's only other organization write is the edit-path `update_node_Bw4VsiNH`. No SO_SAVE run touched this SO between 14:05 and 15:33; the other 4 in that window are the creator's next SOs.
  - The SO form's direct-write handler `onClick_credit_alert` (it writes the whole form, organization included) did not run: the SO prefix counter it moves (`prefix_configuration`, running_number 0) has not changed since 01-01.
  - Nothing wrote the SO between 15:15:04 and 15:32.
- **The same path kept the organization on 135 other SO approvals at Kenhin since 10-20.** 122 of them were passed by the same approver, and 86 were opened before being passed. The approver's session department was the same on all 80 of their approvals since 10-25.
- **The write that emptied it: SO_SAVE's after-approval `update_node_FBCZlcO2` at 15:15:04.640.**
  - It is the only write between the insert (whose request and response both carry organization 2006752085806436353) and the convert.
  - The run's step log has no entry for update nodes, but shows a 133 ms gap (`code_node_9EUEtd8y` ends 15:15:04.603, the next step starts .736) holding the SO's update_time.
  - The node asks only for `so_no` ('issued', so the number rule runs) and `so_status`. So the platform emptied the organization while carrying out that update; nothing in the node definition writes it.
- **Why only this SO: not in the database.** Every factor we can read matches the 135 approvals that kept their organization:
  - workflow version, approver, the approver's session department, and opening the SO before passing it;
  - the length of the wait (45 approvals waited 70 min or more, up to 41 h);
  - the inserted data.
  - The approval tables store no client (web or app). There is no row history, and blade_log_api stopped writing on 10-24.
- **What would show the platform's actual update:** run 2116048709547593729's full log. It is `/app/logs/workflow/20261030/2116048709547593729.log` on the prod server, plus two `.log` files on Kenhin's storage named in its `oss_log_path`; opening them needs a Kenhin login.
- Evidence for the platform team: SO 2116048711493750785, SO_SAVE run 2116048709547593729, slot `slot_node_ehX7sDpE`, process d865d06c-d427-11f1-b71a-5ae8f9deb987, pass at 15:15:02.

## Fix
1. `repair.sql` put back organization 2006752085806436353 (RUN), then the user converted the SO again (GD/20261030/2370).
2. **Optional guard (not built):** SO_SAVE's after-approval update `update_node_FBCZlcO2` could also write `organization_id` (from `code_node_9EUEtd8y.data.latestSOData`). Whatever the platform does at the pass, the SO would then end with its organization.
