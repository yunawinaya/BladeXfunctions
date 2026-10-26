# Sales Invoice: Shipping Method + Vehicle Number, carried from SO / GD (2026-10-26)

**Ask:** add Shipping Method and Vehicle Number to the Sales Invoice, the same as GD. The first version was manual only. The
client then asked for the values to come from the SO / GD (same day), so this folder replaces the manual-only paste set.

**What changes**

- **Sales Invoice form:** two new header fields in the right column, under Project.
  - `si_shipping_method` "Shipping Method" (key `sm5hq2vt`): a table-select on Shipping Method that lists active
    methods of the SI's organization. Cloned from GD `di_shipping_method`.
  - `si_vehicle_number` "Vehicle Number" (key `vn7kx3pd`): a select on Vehicle, with GD's "+" button that opens an
    Add Vehicle dialog (new script `onSiVehicleNumberfunc`, key `vb4rc8wn`). Cloned from GD `di_vehicle_number`, but
    with its label on one line (`labelWrap: false`, like the other SI fields) and the button reading "+ Add"
    (`buttonText: "Add"`, as on SO's Vehicle Number; GD's has no buttonText, so it shows the default "新增").
  - Both stay editable after Completed / Fully Posted (those forms' Update buttons save the whole form).
  - Fill on the form: `onChange_soID`, which runs after "Add from SO / GD", takes `di_shipping_method` /
    `di_vehicle_number` from the first GD when the lines came from a GD, else from the first SO. The GD read asks for
    those two columns only and runs in parallel with the SO read the handler already makes.
  - Publishing the form creates the columns (`sales_invoice.si_shipping_method` varchar(255) → shipping_method.id,
    `sales_invoice.si_vehicle_number` bigint → Vehicle.id). Verified on dev.
- **SI_SAVE:** Add Data (`add_node_adYeQB4a`) and Update Data (`update_node_I7KGszOE`) write the two fields. Both nodes
  use fixed prop lists, so without this the values are never stored.
- **GD_Convert_SI** (GD list / GD form convert, GD auto-SI on completion) and **SO_Convert_SI** (SO list, SI list, Cash
  Sales convert): the header sql-node reads the two columns, and the header map copies them to the SI.
- **SO_SAVE:** the auto-SI of an Issued SO with auto SI on copies the two columns in its header map.
- A combined SI (several SOs / GDs) takes the values from the first document, the same rule as its addresses and
  remarks. The SI copies what the source holds at that moment. Later edits on the SO / GD do not flow down.

**Dev** (published 2026-10-26, backups in `~/Documents/ASC-dev/workflow-backups/dev/`): SI form v393, SI_SAVE v85,
GD_Convert_SI / SO_Convert_SI / SO_SAVE new enabled rows (version numbers stayed v29 / v58 / v172). Builder:
`scratchpad/si_ship/build_si_ship.py`. Offline test (`scratchpad/si_ship/test/test_fill.py [--prod]`, read-only) runs
each Map SI Data node, live vs. patched, on real dev documents. The payloads are identical except the two new keys,
which equal the source's values. Passed for the dev and the prod builds.

## Paste (user), in this order

Every paste file is the prod version that is live now (the matching `*_base.json`) plus this change only. The checks
compare prod with the paste file.

1. **Form first** (the columns must exist before anything writes them): table **Sales Invoice** (`sales_invoice`, id
   **`1902525285396496385`**). Not Sales Invoice Line, not Sales Invoice Print. File `1_SalesInvoice_form.prod_paste.json`.
   Check: `.dbtools/form --prod status sales_invoice prod-hotfix/2026-10-26-si-shipping-vehicle/1_SalesInvoice_form.prod_paste.json`
   says IDENTICAL, and
   `.dbtools/db --prod "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_invoice' AND COLUMN_NAME IN ('si_shipping_method','si_vehicle_number')"`
   returns 2 rows.
2. Workflow **SI_SAVE**, id **`2029040374929154050`**. Not SI_CANCEL, not SI_POST. File `2_SI_SAVE.prod_paste.json`.
3. Workflow **GD_Convert_SI**, id **`2070069049332416514`**. File `3_GD_Convert_SI.prod_paste.json`.
4. Workflow **SO_Convert_SI**, id **`2029006184569364481`**. File `4_SO_Convert_SI.prod_paste.json`.
5. Workflow **SO_SAVE**, id **`1988908545345945602`**: the classic one. Not SO_SAVE_COMMIT / _PREPARE / _RUN / _SUBMIT /
   _WORKER (SO V2), not SO_CASCADE. File `5_SO_SAVE.prod_paste.json`.

Check each workflow: `.dbtools/wf --prod deployed prod-hotfix/2026-10-26-si-shipping-vehicle/<n>_<NAME>.prod_paste.json`
says IDENTICAL.

The repo's GDconvertSIworkflow / SOconvertSIworkflow / SOsaveWorkflow files are dev's. Prod differs from dev only in
where a comment and `carryDescription` sit in the Map SI Data node, so `wf --prod deployed` on those repo files will
still say DIFFERS after the paste.

No data repair is needed. Existing invoices just have the two fields empty.
