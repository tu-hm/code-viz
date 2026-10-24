"""Prints the S7 tables from run.sh's TSV files. usage: python3 -I summarize.py <out dir>"""

import collections
import statistics
import sys
from pathlib import Path

out = Path(sys.argv[1])
CHECKS = ["off", "debug", "assert"]
GCS = ["none", "32768/30", "16384/10"]


def rows(name):
    path = out / name
    if not path.exists():
        return []
    return [line.rstrip("\n").split("\t") for line in path.open() if line.strip()]


def table(header, body):
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for r in body:
        print("| " + " | ".join(r) + " |")
    print()


def probe():
    pch = collections.defaultdict(set)
    peak = {}
    failed = []
    programs = []
    for r in rows("probe.tsv"):
        p, checks, gc, code, used, steps = r[:6]
        if p not in programs:
            programs.append(p)
        pch[p, checks].add(used)
        peak[p, checks, gc] = (float(r[6]), float(r[11]))
        if code != "0":
            failed.append(f"{p} {checks} {gc}: exit {code} {r[10][:80]}")
    if not programs:
        return
    print("## PCH used (-Winvalid-pch -H), and peak / sampled anon MiB in a 1 GiB box\n")
    header = ["program"]
    for c in CHECKS:
        header += [f"{c}: PCH"] + [f"{c}: {gc}" for gc in GCS]
    body = []
    for p in programs:
        cells = [p]
        for c in CHECKS:
            cells.append(" / ".join(sorted(pch[p, c])))
            cells += [f"{peak[p, c, gc][0]:.0f} / {peak[p, c, gc][1]:.0f}" if (p, c, gc) in peak else "-" for gc in GCS]
        body.append(cells)
    table(header, body)
    for f in failed:
        print("- probe failed:", f)
    print()


def fails(runs):
    oom = sum(1 for x in runs if x["oom"] and x["code"] not in (124, 137))
    slow = [x["wall"] for x in runs if x["code"] in (124, 137)]
    parts = []
    if oom:
        parts.append(f"{oom} OOM after {max(x['wall'] for x in runs if x['oom']):.1f} s")
    if slow:
        parts.append(f"{len(slow)} killed at 30 s")
    return ", ".join(parts)


def builds():
    data = collections.defaultdict(list)
    programs = []
    for r in rows("build.tsv"):
        p, checks, gc, cache, rep, hostload, load = r[:7]
        wall, user, sys_, code, peak, oom, refault, majflt = r[7:15]
        anon, file_, shmem, anon_pk, file_pk, samples = r[15:21]
        if p not in programs:
            programs.append(p)
        data[cache, checks, gc, p].append(
            dict(wall=float(wall), code=int(code), peak=float(peak), oom=int(oom), refault=int(refault),
                 majflt=int(majflt), anon=float(anon), file=float(file_), load=float(load)))
    if not programs:
        return

    for cache in ["warm", "cold"]:
        print(f"## Builds, {cache} page cache: worst program per variant\n")
        body = []
        for checks in CHECKS:
            for gc in GCS:
                per = [data[cache, checks, gc, p] for p in programs if data[cache, checks, gc, p]]
                if not per:
                    continue
                ok = [[x for x in runs if x["code"] == 0] for runs in per]
                meds = [statistics.median(x["wall"] for x in runs) for runs in ok if runs]
                allruns = [x for runs in per for x in runs]
                walls = [x["wall"] for x in allruns]
                failed = sum(1 for x in allruns if x["code"] != 0)
                timeouts = sum(1 for x in allruns if x["code"] in (124, 137))
                body.append([checks, gc,
                             f"{max(meds):.2f}" if meds else "-",
                             f"{max(walls):.2f}" if walls else "-",
                             f"{max(x['peak'] for x in allruns):.0f}",
                             f"{max(x['anon'] for x in allruns):.0f}",
                             f"{max(x['file'] for x in allruns):.0f}",
                             f"{failed}/{len(allruns)}" + (f" ({timeouts} at 30 s)" if timeouts else ""),
                             f"{max(x['majflt'] for x in allruns)}",
                             f"{max(x['load'] for x in allruns):.1f}"])
        table(["checks", "gc", "worst median s", "max s, failed runs too", "max peak MiB", "max anon MiB",
               "max file MiB", "failed", "max major faults", "max VM load"], body)

        print(f"### {cache}: build time with GC params ÷ without, per program (median of medians, range)\n")
        body = []
        for checks in CHECKS:
            for gc in GCS[1:]:
                ratios = []
                for p in programs:
                    a = [x["wall"] for x in data[cache, checks, gc, p] if x["code"] == 0]
                    b = [x["wall"] for x in data[cache, checks, "none", p] if x["code"] == 0]
                    if a and b:
                        ratios.append(statistics.median(a) / statistics.median(b))
                if ratios:
                    body.append([checks, gc, f"{statistics.median(ratios):.2f}", f"{min(ratios):.2f}–{max(ratios):.2f}",
                                 str(len(ratios))])
        table(["checks", "gc", "median ratio", "range", "programs built both ways"], body)

        for checks in CHECKS:
            print(f"### {cache}, checks {checks}: median s [min–max], median peak MiB, max anon MiB\n")
            body = []
            for p in programs:
                cells = [p]
                for gc in GCS:
                    runs = data[cache, checks, gc, p]
                    if not runs:
                        cells.append("-")
                        continue
                    ok = [x for x in runs if x["code"] == 0]
                    if not ok:
                        cells.append(f"**failed {len(runs)}/{len(runs)}**: {fails(runs)}, "
                                     f"anon {max(x['anon'] for x in runs):.0f}")
                        continue
                    w = [x["wall"] for x in ok]
                    bad = [x for x in runs if x["code"] != 0]
                    note = f" **{len(bad)} failed**: {fails(bad)}" if bad else ""
                    cells.append(f"{statistics.median(w):.2f} [{min(w):.2f}–{max(w):.2f}], "
                                 f"{statistics.median(x['peak'] for x in runs):.0f}, "
                                 f"{max(x['anon'] for x in runs):.0f}{note}")
                body.append(cells)
            table(["program"] + GCS, body)


def runs(name, builds_):
    data = collections.defaultdict(list)
    programs = []
    for r in rows(name):
        p, hostload, b, kind = r[:4]
        if p not in programs:
            programs.append(p)
        if kind == "build":
            data[p, b].append(dict(build=r[4] if len(r) > 4 else ""))
            continue
        load, wall, user, sys_, code, md5 = r[4:10]
        err = r[10] if len(r) > 10 else ""
        data[p, b].append(dict(wall=float(wall), code=int(code), md5=md5, err=err, load=float(load),
                               hostload=float(hostload)))
    if not programs:
        return

    def stat(p, b, pick):
        xs = data[p, b]
        if not xs:
            return None, "-"
        if "build" in xs[0]:
            return None, "build failed: " + xs[0]["build"]
        bad = [x for x in xs if x["code"] != 0]
        if bad:
            x = bad[0]
            if x["code"] == 124:
                return None, ">60 s"
            return None, f"stopped, exit {x['code']}: {x['err'][:120]}"
        return pick(x["wall"] for x in xs), ""

    def ratio(p, a, b, pick):
        ta, na = stat(p, a, pick)
        tb, nb = stat(p, b, pick)
        if tb is None:
            return "-"
        if ta is None:
            return f">{60 / tb:.0f}×" if na == ">60 s" else na.split(":")[0]
        return f"{ta / tb:.1f}×"

    pairs = [("A", "D"), ("A", "B"), ("A", "C"), ("B", "D"), ("E", "D"), ("E", "B"), ("E", "C"), ("F", "D"), ("G", "D"),
             ("H", "D")]
    pairs = [(a, b) for a, b in pairs if a in builds_ and b in builds_]
    for label, pick in [("median", statistics.median), ("fastest", min)]:
        print(f"## Run time ({name}), {label} of the rounds: s, and ratios\n")
        header = ["program"] + [f"{b} s" for b in builds_] + [f"{a}/{b}" for a, b in pairs]
        body = []
        for p in programs:
            cells = [p]
            for b in builds_:
                t, note = stat(p, b, pick)
                cells.append(f"{t:.3f}" if t is not None else note.split(":")[0])
            cells += [ratio(p, a, b, pick) for a, b in pairs]
            body.append(cells)
        table(header, body)

    notes = []
    for p in programs:
        for b in builds_:
            t, note = stat(p, b, min)
            if note and note != ">60 s":
                notes.append(f"{p} {b}: {note}")
        md5s = {x["md5"] for b in builds_ for x in data[p, b] if "md5" in x and x["code"] == 0}
        if len(md5s) > 1:
            notes.append(f"{p}: outputs differ between builds {sorted(md5s)}")
        spread = [f"{b} {min(x['wall'] for x in data[p, b]):.3f}–{max(x['wall'] for x in data[p, b]):.3f} ({len(data[p, b])})"
                  for b in builds_ if data[p, b] and "wall" in data[p, b][0] and all(x["code"] == 0 for x in data[p, b])]
        notes.append(f"{p} runs: " + ", ".join(spread))
    loads = [x["load"] for xs in data.values() for x in xs if "load" in x]
    hostloads = [x["hostload"] for xs in data.values() for x in xs if "hostload" in x]
    if loads:
        print(f"docker VM load average {min(loads):.1f}–{max(loads):.1f}, host {min(hostloads):.1f}–{max(hostloads):.1f}\n")
    for n in notes:
        print("-", n)
    print()


probe()
builds()
runs("run.tsv", ["A", "B", "C", "D", "E", "F", "G", "H"])
runs("run64.tsv", ["A", "D", "E"])
