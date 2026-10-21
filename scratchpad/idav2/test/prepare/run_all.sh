#!/bin/sh
# Package A checks (read-only): lift still = base v6, build, lint, the suite, the mutation check, every SQL node on dev.
# usage: sh scratchpad/idav2/test/prepare/run_all.sh   (from the repo root; MUTANT_DIR overrides the mutants' temp folder)
set -e
cd "$(dirname "$0")/../../../.."
python3 scratchpad/idav2/lib/lift/lift.py scratchpad/idav2/lift/lift.json --check
python3 scratchpad/idav2/build_prepare.py --write
python3 scratchpad/validate.py "Item Disassembly/AsyncV2/IDA_V2_PREPARE.json"
node scratchpad/idav2/test/prepare/test_prepare.js
IDA_MUTANT_DIR="${MUTANT_DIR:-}" node scratchpad/idav2/test/prepare/mutants.js
python3 scratchpad/idav2/lib/sqlcheck.py "Item Disassembly/AsyncV2" scratchpad/idav2/test/prepare/sqlcheck_values.json IDA_V2_PREPARE
