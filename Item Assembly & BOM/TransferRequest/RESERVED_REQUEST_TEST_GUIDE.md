# Reserved transfer requests: browser test guide (dev, 711077)

How to test requests from a reserved (Created) Item Assembly on dev, with defect handling and replacement requests. Each test
names the design's live test (T1–T16, `RESERVED_REQUEST_DESIGN.md` section 10). After each test, send the IA and LOT numbers;
the rows behind them (reservations, balances, logs) get checked on the dev database.

## Before you start

1. **Account.** Log in to dev as **admin@711077**, which has the **Admin** role. In 711077, Admin and Super Admin both hold the
   three permission keys (`ia_create_transfer_request`, `lot_ia_dispatch`, `lot_ia_receive`). Only **Admin** also has the
   reason pages (step 4).
2. **Stay away from:** the "blade, loose" item at bin A1-01, SO/20261016-034, SO/20261016-035, and item 2783-000000-00.
3. **Staging bin.** Every request in this guide stages at bin **FA**, in storage location **Final Assembly**.
4. **Defect reasons.** 711077 has none yet, and the Reason fields only list your own organisation's reasons. Logged in as
   Admin, open the left menu **Configuration Setting → Organization → Movement Reason → Category Transfer Reason**. Add
   **Damaged** and **Wet**.
   - On any other role, that menu doesn't appear. To use another role, first tick that menu for it in the role's menu
     permissions.
5. **Background saves.** Dispatch and Receive save in the background, and the form closes. The Location Transfer list shows
   the new status after a few seconds. If a request stays **Processing** for more than a minute, report it.

## Test 1: the setup switch, then the normal path (T15, T1, T3, T9)

IA-2610-029 is already **Created** and fully reserved: ME1701, ME1096 and ME1095, 1 each, at bin J3-07. Its finished good is
0445-000000-1323rt, RO-M Fusion 1250x600 / 12mm.

1. Leave the switch **off**. Open IA-2610-029 in Edit.
   - Expect: no **Request Materials** button and no Transfer Request section. Saving it with **Created** works as it does today.
2. **Turn the switch on:** Setting → **Item Assembly Setup** tile → **Transfer Request** on → **Save**.
3. Reopen IA-2610-029. Expect **Request Materials** in the top button bar. Click it.
   - Expect: the Transfer Request section opens, with Staging Storage Location, Staging Bin, Required Date and
     **Create Transfer Request**.
4. Choose **Final Assembly**, bin **FA** and today's date, then click **Create Transfer Request**.
   - Expect the message "Transfer request LOT-… created."
   - Expect the section to read "Transfer request LOT-… · Requested", with **View**, **Refresh** and **Cancel Transfer Request**.
5. Click **View Transfer Request**. It opens on the right, read-only. Expect:
   - the cyan **Requested** badge;
   - the line "Transfer request for Item Assembly IA-2610-029 · required … · requested by …";
   - 3 lines, Requested Qty 1 each, already picked at J3-07. Those picks are the IA's reservation.
6. Open the request from the **Location Transfer** list (Edit).
   - Expect only **Save Picks**, **Dispatch** and **Cancel Request**.
   - Click **Dispatch**. The confirmation names the posting date. Click **Dispatch** again.
   - Expect "being saved in the background". The list then shows it **In Progress**. **(T1)**
7. Reopen IA-2610-029.
   - Expect "In transit (LOT-…): this Item Assembly can't be changed until the request is received." and **View** only.
   - Click **Created** or **Draft**. Expect it refused: "The materials of this Item Assembly are being transferred (transfer
     request LOT-… is In Progress): it can't be changed until that request is received." **(T9, after dispatch)**
8. Click **View Transfer Request**. It now opens editable. Click **Receive**.
   - Expect the **Receive Transfer Request** dialog: one row per line, Dispatched 1, Good 1, Defect 0.
   - Click **Receive**. The request becomes **Completed**. **(T3)**
9. Back on IA-2610-029, expect:
   - "Transfer request LOT-… received: its materials are reserved for this Item Assembly at the staging bin.";
   - **View** and **Report Defect** only (no Request Replacement, because nothing is missing);
   - the 3 lines' stock now at FA.
10. Click **Completed**. Expect it to complete from FA. **(T3)**

## Test 2: another bin, a defect at Receive, the replacement (T2, T4, T5)

Make a new Item Assembly for 0445-000000-1323rt, quantity 1. Its components are the same 3 cable items, and they also have stock
at bin A2-01. Click **Created**. Expect the reservation row to say **Fully reserved**.

1. Click **Request Materials**, choose Final Assembly / FA and today, then **Create Transfer Request**.
2. Open the request (Edit). On line 1, click **Select Stock**.
   - Expect the bin it is reserved at to show that quantity as available. The IA's own reservation counts as free here.
   - Pick it from **A2-01** instead and confirm. Click **Save Picks**, then **Dispatch**. **(T2)**
3. Once it is In Progress, reopen it. Expect its line to end with
   "bins to count: J3-07 (… picked from A2-01 instead)". **(T2)**
4. Open the request from the IA (**View Transfer Request**) and click **Receive**. On line 1, set Good 0 and Defect 1.
   - Click **Receive** without a reason. Expect "Line 1 (…): choose the reason for the defect."
   - Choose **Damaged** and click **Receive**. **(T4)**
5. When the form closes, the IA asks **Request a replacement**. Click **Not now**.
   - Expect "1 line(s) still need materials: request a replacement." and the **Request Replacement** button. **(T4)**
6. Click **Request Replacement**.
   - Expect "The missing materials are allocated outside the staging bin: save the Item Assembly as Created to reserve them,
     then press Request Replacement."
   - Click **Created**, then **Request Replacement** again. Expect "Replacement request LOT-… created."
   - The section lists both requests: "· Requests: LOT-new (Requested), LOT-old (Completed)".
   - The new request's line says "replacement for LOT-old". **(T5)**
7. Dispatch and Receive the replacement as in Test 1 steps 6 and 8, then click **Completed** on the IA. **(T5)**

The defective unit stays **Blocked** at FA. Its reason is on the request's line.

## Test 3: Report Defect after Receive (T7)

Use an IA whose request is received but not completed yet. Make a new one as in Test 2, then request, dispatch and receive.

1. Click **Report Defect**. Expect a dialog with one row per pick at FA, and one row per batch for a batch item.
2. Set Defective Qty 1 and Reason **Wet**, then click **Report Defect**. Expect:
   - "Defect reported: moved to Blocked at the staging bin. Request a replacement for what is missing.";
   - the section says 1 line still needs materials, and **Request Replacement** is shown;
   - that line's pick at FA drops by 1.
3. Try these refusals. Each one shows a message and changes nothing:
   - more than is at FA: "at most …";
   - no reason: "choose the reason";
   - two batches of one line with different reasons: "one reason per line".

## Test 4: cancel before and after dispatch (T8)

1. **Before dispatch.** Make a Created IA. Click **Request Materials**, then **Create Transfer Request**, then
   **Cancel Transfer Request**, and confirm.
   - Expect "… cancelled." The IA's reservation still says **Fully reserved**, and **Request Materials** comes back.
2. **After dispatch.** Click **Request Materials** again and create the request. Dispatch it.
   - Once it is In Progress, go to the **Location Transfer** list, select it and click **Cancel**.
   - Expect it **Cancelled**, and the stock back at the bins it was picked from, reserved for the IA again. The IA says
     **Fully reserved**.

## Test 5: changing the IA while its request is Requested (T9, before dispatch)

1. On a Created IA with a Requested request, change a component's quantity or pick, then click **Created**.
   - Expect "… this Item Assembly's reservation changed since it was made: refresh it".
2. Click **Refresh Transfer Request** and confirm. Expect "… refreshed". The request's lines follow the IA, at revision 2.

## Test 6: completing the IA (T10)

1. With its request Requested or In Progress, click **Completed**. Expect it refused: "Transfer request LOT-… of this Item
   Assembly is Requested: receive it or cancel it before completing the Item Assembly."
2. After a receipt, add a component line that was never reserved, picked from a warehouse bin, and click **Completed**. Expect
   it refused: "Line N (…): take it from FA, where transfer request LOT-… delivered the materials; request a replacement for
   what is missing."
3. If a serial-numbered component is available, add it picked from a warehouse bin. Expect it allowed: serial lines are
   exempt.

## Test 7: reservation and cancel while in transit (T11)

With a request In Progress:

1. In the **Item Assembly** list, select the IA and click **Retry Reservation** (or reopen the IA).
   - Expect nothing reserved again at the old bins. The reservation answers "In transit (LOT-…): …".
2. In the Item Assembly list, select the IA and click **Cancel**.
   - Expect the IA left alone: "IA-…: transfer request LOT-… is In Progress: cancel the request first".

## Test 8: a partly reserved IA, and stock that isn't there (T6, T13)

1. **T6.** Use an IA with one component short, so it says **Partially reserved**. Click **Request Materials**.
   - Expect the request to carry only what is reserved.
   - After the receipt, **Request Replacement** covers the rest once the stock exists.
2. **T13.** Use a Requested request whose reserved bin is really empty.
   - Lower that line's pick on the IA and click **Created**, so the reservation drops.
   - Refresh the request, then dispatch it in full for what was found.
   - Count the bin with a Stock Count, then replace the rest.

## Test 9: a batch item with a defect in one batch (T14)

711077 has no batch-managed component with stock in two batches. Ask for one to be set up first (a small Misc Receipt in two
batches) before running this test.

1. In the Receive dialog, that line shows one row per batch. Put the Defect on one batch only.
2. Expect only that batch **Blocked**. The IA's picks and reservation keep the other batch.

## Test 10: nothing else changed (T12)

1. An IA with no request: **Draft**, then **Created**, then **Completed**, exactly as before.
2. An ordinary Location Transfer: **Save as Draft**, then **In Progress**, then **Completed**, exactly as before: the usual
   buttons, and no Requested badge.

## Test 11: setup turned off while a request is in transit (T16)

1. With a request In Progress, turn **Transfer Request** off and click **Save**.
2. Expect **Receive** to still work for that request, and **Report Defect** and **Request Replacement** to still work for its
   IA.
3. Expect a new IA to show no request section.
4. Turn the switch back on afterwards.

## Good to know

- **When the replacement offer appears.** It appears when the request's form closes after a save that you opened from the
  IA's **View Transfer Request**. If you receive from the Location Transfer list instead, it appears the next time you open
  the IA, once per browser.
- **Request Replacement takes two clicks.** The first allocates what is missing. You then click **Created** to reserve it, and
  the second click sends the replacement request.
- **What to send after each test:** the IA and LOT numbers, and a screenshot of any message that looks wrong.
