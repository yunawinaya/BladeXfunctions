import re, subprocess, tempfile, os, sys
def check(src, label):
    stub = re.sub(r"\{\{[^}]*\}\}", "null", src)
    stub = "(async function(){\n" + stub + "\n})();"
    fd, path = tempfile.mkstemp(suffix=".js"); os.write(fd, stub.encode()); os.close(fd)
    r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    os.unlink(path)
    print(f"  {label:34} {'OK' if r.returncode==0 else 'FAIL'}")
    if r.returncode: print(r.stderr[:600])
    return r.returncode == 0
if __name__ == "__main__":
    check(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1].split("/")[-1])
