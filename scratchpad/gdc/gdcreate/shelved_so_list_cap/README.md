# Shelved (user, 2026-10-26: "ignore the cap"): SO list convert concurrency cap

`GDhandleConvertSOtoGD.cap.patch` caps the SO list's GD_ASYNC_WORKER kicks at 8 job ids at a time, plus a longer follow for long
lists. `test_convert_follow_cap.js` tests it against the patched handler (apply the patch first).

Known flaw, to fix before any revival: a job_id kick is not one job. GD_ASYNC_WORKER's poll takes the kicked job plus up to 9
other due jobs (attempt_count < 3, unclaimed, overdue 10 s), and works them for up to 240 s. So 8 kicks can mean far more than
8 creations at once, and the test's one-job-per-kick model overstates the cap.
