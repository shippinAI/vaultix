#!/usr/bin/env python3
"""Vaultix upstream endpoint classifier (ADR 0005).

Resolves the upstream Fastify registration tree into exact
(method, path-shape) -> source-file mappings, then classifies every operation
of a captured OpenAPI spec as MIT-core or ee. Handles:

  - nested server.register() wrappers with prefix options
  - per-file import resolution (duplicate export names across v1/v2 files)
  - router-map loops: Object.entries(X_MAP) + withRoutePrefix(`/${seg}`),
    with map keys resolved through enum values ([Enum.Member] -> "segment")
  - direct invocation mounts: await registerX(router) inside a wrapper
  - endpoint factories: fn bodies that call register*Endpoints({...})

Inputs:
  1. upstream checkout of the pinned tag (sparse ok; needs
     backend/src/server/routes, backend/src/ee/routes, **/*enums.ts,
     backend/src/ee/services/external-kms/providers)
  2. OpenAPI spec captured from a running core (capture-openapi.sh)

Output TSV: method, path, tree (core|ee|unresolved), basis, tags, operationId
  basis "source" = exact match against the resolved registration tree
  basis "unresolved" = no match; listed, never guessed

Usage: classify.py <upstream-checkout-root> <openapi.json> <out.tsv>
"""
import json
import os
import re
import sys
from collections import defaultdict

ROUTE_CALL_RE = re.compile(r"\.route\(\s*\{")
ROUTE_METHOD_RE = re.compile(r"method:\s*(\[[^\]]*\]|[\w.\"'`]+)")
ROUTE_URL_RE = re.compile(r"url:\s*[\"'`]([^\"'`$]*)[\"'`]")
EXPORT_RE = re.compile(r"export const ((?:register|create)\w+)\s*=")
METHOD_RE = re.compile(r"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)", re.I)
ENUM_RE = re.compile(r"enum (\w+)\s*\{([^}]*)\}", re.S)
ENUM_MEMBER_RE = re.compile(r"(\w+)\s*=\s*[\"'`]([^\"'`]+)[\"'`]")
MAP_DEF_RE = re.compile(r"(?:export\s+)?const (\w*(?:ROUTER_MAP|RouterMap)\w*)")
MAP_ASSIGN_RE = re.compile(r"=\s*\{")
MAP_ENTRY_RE = re.compile(
    r"\[(\w+)\.(\w+)\]\s*:\s*(register\w+)|[\"'`]([\w-]+)[\"'`]\s*:\s*(register\w+)"
)
REG_CALL_RE = re.compile(r"\.register\(\s*")
MAP_LOOP_RE = re.compile(r"Object\.entries\((\w+)\)")
CALL_RE = re.compile(r"\b((?:register|create)\w+)\s*(?:<[^()]*?>)?\s*\(")
IMPORT_RE = re.compile(r"import\s*\{([^}]*)\}\s*from\s*[\"']([^\"']+)[\"']", re.S)


def read(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def brace_span(text, open_idx):
    opener = text[open_idx]
    closer = {"{": "}", "(": ")"}[opener]
    depth, i = 0, open_idx
    while i < len(text):
        if text[i] == opener:
            depth += 1
        elif text[i] == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def skip_ws(text, i):
    while i < len(text) and text[i] in " \t\r\n":
        i += 1
    return i


class Upstream:
    """Parsed upstream tree with per-file symbol resolution."""

    def __init__(self, src_root):
        self.src = src_root
        self.texts = {}       # relfile -> text
        self.exports = {}     # (relfile, fn) -> body
        self.by_name = defaultdict(list)  # fn -> [relfile]
        self.imports = {}     # relfile -> {local name -> relfile}
        self.enums = defaultdict(dict)
        self.maps = {}        # (relfile, MAP_NAME) -> [(segment, fn local name)]
        self._scan()

    def _scan(self):
        for base in ("server", "ee", "services"):
            root = os.path.join(self.src, base)
            for dirpath, _, files in os.walk(root):
                for f in files:
                    if f.endswith(".ts") and not f.endswith((".dev.ts", ".test.ts")):
                        p = os.path.join(dirpath, f)
                        rel = os.path.relpath(p, self.src).replace(os.sep, "/")
                        self.texts[rel] = read(p)

        for rel, t in self.texts.items():
            for em in ENUM_RE.finditer(t):
                for mm in ENUM_MEMBER_RE.finditer(em.group(2)):
                    self.enums[em.group(1)].setdefault(mm.group(1), mm.group(2))

        for rel, t in self.texts.items():
            if "/routes/" not in rel:
                continue
            for em in EXPORT_RE.finditer(t):
                body = self._fn_body(t, em.end())
                if body is None:
                    continue
                self.exports[(rel, em.group(1))] = body
                self.by_name[em.group(1)].append(rel)

            imp = {}
            for im in IMPORT_RE.finditer(t):
                target = self._resolve_module(rel, im.group(2))
                if target:
                    for name in im.group(1).split(","):
                        name = name.strip().split(" as ")[-1].strip()
                        if name:
                            imp[name] = target
            self.imports[rel] = imp

            for dm in MAP_DEF_RE.finditer(t):
                am = MAP_ASSIGN_RE.search(t, dm.end(), dm.end() + 500)
                if not am:
                    continue
                block = t[am.end() - 1 : brace_span(t, am.end() - 1)]
                entries = []
                for em in MAP_ENTRY_RE.finditer(block):
                    if em.group(3):
                        val = self.enums.get(em.group(1), {}).get(em.group(2))
                        entries.append((val or f"?{em.group(1)}.{em.group(2)}", em.group(3)))
                    else:
                        entries.append((em.group(4), em.group(5)))
                if entries:
                    self.maps[(rel, dm.group(1))] = entries

    @staticmethod
    def _fn_body(t, start):
        """Full right-hand side of the export declaration: everything up to
        the ";" at zero bracket depth. Covers arrow fns (block or expression
        bodied), curried factories, and alias-call exports uniformly — route
        and call extraction operate on the whole expression text."""
        i = skip_ws(t, start)
        depth, j, in_str = 0, i, ""
        while j < len(t):
            c = t[j]
            if in_str:
                if c == in_str and t[j - 1] != "\\":
                    in_str = ""
            elif c in "\"'`":
                in_str = c
            elif c in "({[":
                depth += 1
            elif c in ")}]":
                depth -= 1
            elif c == ";" and depth == 0:
                break
            j += 1
        body = t[i:j]
        return body if body else None

    def _resolve_module(self, from_rel, mod):
        if mod.startswith("@app/"):
            cand = mod[len("@app/"):]
        elif mod.startswith("."):
            cand = os.path.normpath(os.path.join(os.path.dirname(from_rel), mod)).replace(os.sep, "/")
        else:
            return None
        for suffix in (".ts", "/index.ts"):
            if cand + suffix in self.texts:
                return cand + suffix
        return None

    def resolve(self, from_rel, name):
        """Resolve a register-fn name in the context of from_rel -> (file, name)."""
        target = self.imports.get(from_rel, {}).get(name)
        if target:
            if (target, name) in self.exports:
                return (target, name)
            # index.ts re-export chain
            sub = self.imports.get(target, {}).get(name)
            if sub and (sub, name) in self.exports:
                return (sub, name)
        if (from_rel, name) in self.exports:
            return (from_rel, name)
        files = self.by_name.get(name, [])
        if len(files) == 1:
            return (files[0], name)
        return None

    def resolve_map(self, from_rel, map_name):
        for rel in [from_rel, self.imports.get(from_rel, {}).get(map_name)]:
            if rel and (rel, map_name) in self.maps:
                return rel, self.maps[(rel, map_name)]
        # maps re-exported through a routers/index.ts
        target = self.imports.get(from_rel, {}).get(map_name)
        if target:
            for (rel, name), entries in self.maps.items():
                if name == map_name and rel.startswith(os.path.dirname(target)):
                    return rel, entries
        for (rel, name), entries in self.maps.items():
            if name == map_name:
                return rel, entries
        return None, []

    def tree_of(self, rel):
        return "ee" if rel.startswith("ee/") else "core"


def parse_register_calls(body):
    out = []
    for m in REG_CALL_RE.finditer(body):
        i = skip_ws(body, m.end())
        callee, inline = None, None
        fm = re.match(r"register\w+", body[i:])
        if fm and body[i + fm.end() : i + fm.end() + 1] != "(":
            callee = fm.group(0)
            i += fm.end()
        elif body[i:].startswith("async"):
            bo = body.index("{", i)
            end = brace_span(body, bo)
            inline = body[bo:end]
            i = end
        else:
            continue
        prefix = ""
        j = skip_ws(body, i)
        if j < len(body) and body[j] == ",":
            j = skip_ws(body, j + 1)
            if j < len(body) and body[j] == "{":
                opts = body[j:brace_span(body, j)]
                pm = re.search(r"prefix:\s*[\"'`]([^\"'`]*)[\"'`]", opts)
                if pm:
                    prefix = pm.group(1)
        out.append((callee, prefix, inline))
    return out


def resolve_mounts(up):
    """(file, fn) -> {absolute mount prefix}."""
    mounts = defaultdict(set)
    root_rel = "server/routes/index.ts"
    root = up.texts[root_rel]
    rm = re.search(r"export const registerRoutes\b", root)
    root_body = root[rm.end():] if rm else root

    def mount(ref, base, seen):
        if ref is None or base in mounts[ref]:
            return
        mounts[ref].add(base)
        if ref in up.exports and ref not in seen:
            walk(up.exports[ref], base, ref[0], seen | {ref})

    def walk(body, base, file, seen=frozenset()):
        for callee, prefix, inline in parse_register_calls(body):
            if inline is not None:
                walk(inline, base + prefix, file, seen)
            elif callee:
                mount(up.resolve(file, callee), base + prefix, seen)
        for lm in MAP_LOOP_RE.finditer(body):
            # static template portion before the variable, e.g.
            # withRoutePrefix(r, `/data-sources/${type}`) -> "/data-sources/"
            static = "/"
            tm = re.search(r"withRoutePrefix\(\s*\w+\s*,\s*`([^`$]*)\$\{", body[lm.end() : lm.end() + 300])
            if tm:
                static = tm.group(1)
            map_file, entries = up.resolve_map(file, lm.group(1))
            for seg, fn in entries:
                if not seg.startswith("?"):
                    mount(up.resolve(map_file, fn), base + static.rstrip("/") + "/" + seg, seen)
        for cm in CALL_RE.finditer(body):
            # direct invocation: await registerX(router) mounts at current base
            arg = body[cm.end() : cm.end() + 30].lstrip()
            if arg.startswith("withRoutePrefix"):
                sm = re.match(r"withRoutePrefix\(\s*\w+\s*,\s*[\"'`]([^\"'`$]+)[\"'`]", arg)
                mount(up.resolve(file, cm.group(1)), base + (sm.group(1) if sm else ""), seen)
            elif not arg.startswith("{"):
                ref = up.resolve(file, cm.group(1))
                if ref in up.exports:
                    mount(ref, base, seen)

    walk(root_body, "", root_rel)
    return mounts


def methods_of(raw):
    raw = raw.strip()
    if raw.startswith("["):
        return [x.upper() for x in re.findall(r"[\"'`](\w+)[\"'`]", raw)]
    m = METHOD_RE.search(raw)
    return [m.group(1).upper()] if m else []


def routes_of(up, ref, _memo=None, _stack=frozenset()):
    """Route defs in ref's body plus endpoint factories it calls."""
    if _memo is None:
        _memo = {}
    if ref in _memo:
        return _memo[ref]
    body = up.exports.get(ref, "")
    out = []
    for m in ROUTE_CALL_RE.finditer(body):
        bo = body.index("{", m.start())
        obj = body[bo:brace_span(body, bo)]
        mm, um = ROUTE_METHOD_RE.search(obj), ROUTE_URL_RE.search(obj)
        if mm and um:
            for meth in methods_of(mm.group(1)):
                out.append((meth, um.group(1)))
    for cm in CALL_RE.finditer(body):
        arg = body[cm.end() : cm.end() + 30].lstrip()
        if arg.startswith("withRoutePrefix"):
            continue
        callee = up.resolve(ref[0], cm.group(1))
        if callee and callee != ref and callee not in _stack:
            out.extend(routes_of(up, callee, _memo, _stack | {ref}))
    _memo[ref] = out
    return out


def route_table(up, mounts):
    """(method, shape-path) -> tree. Core wins over ee on a shape collision."""
    table = {}
    memo = {}
    for ref in up.exports:
        tree = up.tree_of(ref[0])
        for base in mounts.get(ref, ()):
            if not base.startswith("/api/"):
                continue
            for meth, url in routes_of(up, ref, memo):
                full = base + ("" if url == "/" else url)
                shape = re.sub(r":\w+", "*", full)
                key = (meth, shape)
                if key not in table or (table[key] == "ee" and tree == "core"):
                    table[key] = tree
    return table


def classify(checkout_root, spec_path, out_path):
    src = os.path.join(checkout_root, "backend/src")
    up = Upstream(src)
    mounts = resolve_mounts(up)
    table = route_table(up, mounts)
    spec = json.load(open(spec_path))

    rows, counts = [], defaultdict(int)
    for path, ops in sorted(spec["paths"].items()):
        shape = re.sub(r"\{\w+\}", "*", path)
        for meth, op in ops.items():
            if meth not in ("get", "post", "put", "patch", "delete"):
                continue
            M = meth.upper()
            tree = table.get((M, shape))
            basis = "source" if tree else "unresolved"
            tree = tree or "unresolved"
            rows.append((M, path, tree, basis, ",".join(op.get("tags", [])), op.get("operationId", "")))
            counts[(tree, basis)] += 1

    with open(out_path, "w") as out:
        out.write("method\tpath\ttree\tbasis\ttags\toperationId\n")
        for r in rows:
            out.write("\t".join(r) + "\n")
    return rows, counts, up, mounts


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    rows, counts, up, mounts = classify(sys.argv[1], sys.argv[2], sys.argv[3])
    total = sum(counts.values())
    print(f"total operations: {total}")
    for (tree, basis), n in sorted(counts.items()):
        print(f"  {tree:10s} {basis:12s} {n:5d}")
    unresolved = [r for r in rows if r[2] == "unresolved"]
    if unresolved:
        print(f"\nunresolved: {len(unresolved)} (first 30)")
        for r in unresolved[:30]:
            print(f"  {r[0]:6s} {r[1]}")
    bad_enum = {s for m in up.maps.values() for s, _ in m if s.startswith("?")}
    if bad_enum:
        print(f"\nWARNING unresolved enum segments: {sorted(bad_enum)[:10]}")
