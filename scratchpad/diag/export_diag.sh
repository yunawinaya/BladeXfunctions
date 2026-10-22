#!/bin/zsh
# export_diag.sh: read-only diagnostics bundle of the sudu-lowcode CLI on this machine (the Xanto app's diagnose export,
# without the app). No saved logins / tokens are included; no workflow run logs are fetched (a big one takes dev down).
STAMP=$(date +%Y%m%d_%H%M%S)
OUT=~/Documents/ASC-dev/diagnose/sudu-lowcode-diag_$STAMP
APP=~/Documents/ASC-dev/sudu-lowcode-apps/dev-main/1901532458164277249
mkdir -p "$OUT"
run() { local name=$1; shift; ( cd "$APP" && "$@" ) > "$OUT/$name.txt" 2>&1; echo "$name: exit $? ($(wc -c < "$OUT/$name.txt" | tr -d ' ') bytes)"; }
run 01_version            sudu-lowcode --version
run 02_status_dev-main    sudu-lowcode status
run 03_status_dev-main-write sudu-lowcode --profile dev-main-write status
run 04_runtime_status     sudu-lowcode runtime status --format json
run 05_env_inspect        sudu-lowcode env inspect --refresh --format json
run 06_rules_status       sudu-lowcode rules status --format json
run 07_doctor             sudu-lowcode doctor --format json
python3 - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]; home = os.path.expanduser('~')
prof = json.load(open(home + '/.config/sudu-lowcode/profiles.json'))
for p in prof.get('profiles', {}).values(): p.pop('sm2PublicKey', None)
json.dump(prof, open(out + '/08_profiles.json', 'w'), indent=2)
lines = open(home + '/.local/share/sudu-lowcode/audit.jsonl', encoding='utf-8').read().splitlines()[-200:]
open(out + '/09_audit_last200.jsonl', 'w').write('\n'.join(lines) + '\n')
m = home + '/Documents/ASC-dev/sudu-lowcode-apps/dev-main/1901532458164277249/.mirror.json'
if os.path.exists(m): open(out + '/10_mirror.json', 'w').write(open(m).read())
blob = ''.join(open(os.path.join(out, f), encoding='utf-8', errors='ignore').read() for f in os.listdir(out))
for bad in ('accessToken', 'refreshToken', 'BLADE_JWT_SECRET', 'Bearer ey', 'bearer ey'):
    assert bad not in blob, 'secret-looking text found: ' + bad
print('no tokens in the bundle (checked)')
PY
rm -rf "$APP/.su-code/metrics/" 2>/dev/null
( cd ~/Documents/ASC-dev/diagnose && zip -qr "sudu-lowcode-diag_$STAMP.zip" "sudu-lowcode-diag_$STAMP" )
echo "bundle: $OUT.zip ($(du -h "$OUT.zip" | cut -f1))"
