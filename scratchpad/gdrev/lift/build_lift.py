"""Lift the revert nodes of lift/nodes.json from their pinned DEPLOYED versions into lift/lifted_revert.js, with
gdc's unchanged lift/lift.py."""
import json, os, subprocess, sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from src import fetch  # noqa: E402

spec = json.load(open(os.path.join(HERE, "nodes.json")))["sources"]
args = [fetch(s) + ":" + ",".join(s["nodes"]) for s in spec]
subprocess.run([sys.executable, R + "scratchpad/gdc/lift/lift.py", os.path.join(HERE, "lifted_revert.js")] + args, check=True)
