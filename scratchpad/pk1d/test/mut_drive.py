"""mut_drive.py: each MUTANT breaks one rule of PICKING_FC_DRIVE's code, rebuilds Picking/AsyncV2/PICKING_FC_DRIVE.json from it and
runs test_drive.js, which must then FAIL (killed). The built file is restored afterwards. usage: python3 mut_drive.py"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import build_drive as B  # noqa: E402

MUTANTS = [
    ("the line-weight budget off", "drive_next.js", "D.weightDone + m.weight > DRIVE_BUDGET.weight", "false"),
    ("the time budget off", "drive_next.js", "elapsed >= DRIVE_BUDGET.seconds", "false"),
    ("the first action budgeted too", "drive_next.js", 'if (i > 0 && a.kind === "SUBMIT"', 'if (i >= 0 && a.kind === "SUBMIT"'),
    ("13 slots", "drive_entry.js", "const DRIVE_SLOTS = 12;", "const DRIVE_SLOTS = 13;"),
    ("another run's BUSY taken as ours", "drive_call.js", '(route === "BUSY" && s(r.cascade_ref) === s(next.cascadeRef))', '(route === "BUSY")'),
    ("a refusal while committing aborts", "drive_call.js", 'next.phase === "COMMIT" ? "FC_REVIEW" : "FC_ABORT"', '"FC_ABORT"'),
    ("another run's live lease ignored", "drive_entry.js", "owner !== guard.leaseOwner && owner !== s(guard.callerLease)", "false"),
    ("the caller's lease not taken over", "drive_entry.js", " && owner !== s(guard.callerLease)", ""),
    ("no touch of the Picking lock", "drive_entry.js", 'needTouch: "YES"', 'needTouch: "NO"'),
    ("F0 ignores the rows", "drive_f0.js", "if (fcRowsFingerprint(", "if (false && fcRowsFingerprint("),
    ("F0 ignores the records", "drive_f0.js",
     "if (num(agg.a) !== num(fp.recCount) || Math.abs(num(agg.b) - num(fp.recSum)) > 1e-6 || s(agg.c) !== s(fp.recMaxId))", "if (false)"),
    ("F0 ignores a changed record quantity", "drive_f0.js", " || Math.abs(num(agg.b) - num(fp.recSum)) > 1e-6", ""),
    ("F0 ignores the deliveries' statuses", "drive_f0.js", "if (changed.length) why.push", "if (false) why.push"),
    ("no re-plan of a hold sharing an SO line", "drive_state.js", "shared[m.gi] = entry.manifest.some(", "shared[m.gi] = false && entry.manifest.some("),
    ("the hold never moves the job on", "drive_next.js", 'job_status: "COMMITTING_PICKING"', 'job_status: "READY_TO_COMMIT"'),
    ("the stamp keeps the lease", "drive_final.js", "next_attempt_at: dbNow, lease_owner: null,", "next_attempt_at: dbNow, lease_owner: \"DRV|x\","),
    ("the stamp is not due at once", "drive_final.js", "attempt_count: 0, next_attempt_at: dbNow,", "attempt_count: 0, next_attempt_at: \"2099-01-01 00:00:00\","),
    ("no unlock on ABORTED", "drive_final.js", 'needUnlock: /^[0-9]{1,20}$/.test(s(entry.pickingId)) ? "YES" : "NO"', 'needUnlock: "NO"'),
    ("the budget answer kicks nothing", "drive_final.js", ": D.kickAll;", ": [];"),
    ("FC_GDS not written", "drive_next.js", 'stepRows: step("FC_GDS", "updated: " + n), needStep: "YES"', 'stepRows: [], needStep: "NO"'),
]


def main():
    orig = B.text
    with open(B.OUT, encoding="utf-8") as f:
        built = f.read()
    killed = 0
    try:
        for name, file, a, b in MUTANTS:
            def text(n, file=file, a=a, b=b, name=name):
                t = orig(n)
                if n == file:
                    assert t.count(a) == 1, "%s: %r occurs %d times in %s" % (name, a, t.count(a), file)
                    t = t.replace(a, b)
                return t
            B.text = text
            B.K._rng.seed("pk1d:PICKING_FC_DRIVE")
            B.K._taken.clear()
            with open(B.OUT, "w", encoding="utf-8") as f:
                f.write(B.fmt(B.build()))
            r = subprocess.run(["node", os.path.join(HERE, "test_drive.js")], capture_output=True, text=True)
            ok = r.returncode != 0
            killed += ok
            print("%s %s%s" % ("KILLED  " if ok else "SURVIVED", name, "" if ok else "  <- " + r.stdout.strip().split("\n")[-1]))
    finally:
        B.text = orig
        with open(B.OUT, "w", encoding="utf-8") as f:
            f.write(built)
    print("%d/%d mutants killed" % (killed, len(MUTANTS)))
    sys.exit(0 if killed == len(MUTANTS) else 1)


if __name__ == "__main__":
    main()
