"""Rebuild the Character Helper tag database.

Port of tools/build_db.py from Adamovix/ComfyUI-Character-Helper that reads its
field rules and tuning knobs from JSON files instead of field_rules.py.

    python character_db_build.py --work DIR --out DIR --rules field_rules.jsonc --settings build_settings.jsonc --report field_report.txt
"""

from __future__ import annotations

import argparse
import collections
import gzip
import heapq
import importlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request

PACKAGES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "python-packages")
sys.path.insert(0, PACKAGES)

HF = "https://huggingface.co/datasets/{repo}/resolve/main/{path}"
SOURCES = {
    "posts.parquet": ("nyanko-devs/danbooru2026", "metadata/posts-snapshot.parquet"),
    "taxonomy.parquet": ("Mexes/danbooru-tag-taxonomy", "tags.parquet"),
    "tag_groups.parquet": ("itterative/danbooru_wikis_full", "tag_groups.parquet"),
    "tag_implications.parquet": ("itterative/danbooru_wikis_full", "tag_implications.parquet"),
}
JIO7_CATEGORIES = ("attire", "feature", "action", "setting", "expression", "object")
SOURCES.update({f"jio7_{c}.csv": ("Jio7/danbooru-tags-classified", f"{c}.csv") for c in JIO7_CATEGORIES})
USER_AGENT = "koharu-character-helper"
STEPS = 4
DISK_MARGIN_BYTES = 5 * 10**8
RECOMMENDED_RAM_BYTES = 8 * 10**9
DOWNLOAD_ATTEMPTS = 3
PROGRESS_INTERVAL = 0.5
NUMBER_SETTINGS = ("min_general_count", "min_character_count", "min_series_count", "canon_min_posts",
                   "char_tags_per_field", "char_min_freq", "pool_min_score", "pool_min_general_tags",
                   "pool_min_kept_tags", "pool_seed", "jobs")


class BuildError(Exception):
    pass


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def emit(kind, payload):
    print(f"@@{kind} " + json.dumps(payload), flush=True)


def progress(step, label, done=None, total=None, unit=None):
    emit("progress", dict(step=step, steps=STEPS, label=label, done=done, total=total, unit=unit))


def warn(message):
    log("warning:", message)
    emit("warning", message)


def gb(n):
    return f"{n / 1e9:.1f} GB"


def strip_comments(text):
    return "\n".join("" if line.lstrip().startswith("//") else line for line in text.splitlines())


def load_json(path):
    name = os.path.basename(path)
    try:
        with open(path, encoding="utf8") as f:
            return json.loads(strip_comments(f.read()))
    except FileNotFoundError:
        raise BuildError(f"{name} is missing. Use Reset to defaults in Settings to recreate it.") from None
    except json.JSONDecodeError as e:
        raise BuildError(f"{name} is not valid (line {e.lineno}, column {e.colno}): {e.msg}. Comments must "
                         f"sit on their own line starting with //.") from None


def check_settings(settings):
    missing = [k for k in (*NUMBER_SETTINGS, "pool_size", "count_tags") if k not in settings]
    if missing:
        raise BuildError(f"build_settings.jsonc is missing {', '.join(missing)}. Add them back or use Reset to defaults.")
    wrong = [k for k in NUMBER_SETTINGS if isinstance(settings[k], bool) or not isinstance(settings[k], (int, float))]
    pool = settings["pool_size"]
    if not isinstance(pool, dict) or any(not isinstance(pool.get(r), int) for r in "gsqe"):
        wrong.append("pool_size (needs whole numbers for g, s, q and e)")
    if not isinstance(settings["count_tags"], list):
        wrong.append("count_tags (needs a list of tags)")
    if wrong:
        raise BuildError(f"build_settings.jsonc has invalid values for {', '.join(wrong)}.")


def ensure_packages():
    try:
        import numpy  # noqa: F401
    except ImportError:
        raise BuildError("ComfyUI's Python has no numpy. Check the Python folder in Settings > ComfyUI.") from None
    try:
        import pyarrow  # noqa: F401
        return
    except ImportError:
        pass
    progress(1, "Installing pyarrow")
    log(f"pyarrow is missing, installing it into {PACKAGES}")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                               "--no-deps", "--upgrade", "--target", PACKAGES, "pyarrow"])
        importlib.invalidate_caches()
        import pyarrow  # noqa: F401
    except (subprocess.CalledProcessError, ImportError) as e:
        raise BuildError(f"Could not install pyarrow ({e}). Install it into ComfyUI's Python with "
                         f"`python -m pip install pyarrow` and rebuild.") from None


def available_memory():
    if sys.platform == "win32":
        import ctypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong),
                        ("total_phys", ctypes.c_ulonglong), ("avail_phys", ctypes.c_ulonglong),
                        ("total_page", ctypes.c_ulonglong), ("avail_page", ctypes.c_ulonglong),
                        ("total_virtual", ctypes.c_ulonglong), ("avail_virtual", ctypes.c_ulonglong),
                        ("avail_extended", ctypes.c_ulonglong)]

        status = MemoryStatus(length=ctypes.sizeof(MemoryStatus))
        return status.avail_phys if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)) else None
    try:
        return os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
    except (ValueError, OSError, AttributeError):
        return None


def read_table(work, name):
    import pyarrow.parquet as pq
    try:
        return pq.read_table(os.path.join(work, name)).to_pydict()
    except Exception as e:
        raise BuildError(f"{name} could not be read ({e}). Use Delete downloads in Settings, then rebuild "
                         f"to download it again.") from None


# Field rules
class Rules:
    def __init__(self, data):
        try:
            self._load(data)
        except KeyError as e:
            raise BuildError(f"field_rules.jsonc is missing {e}. Add it back or use Reset to defaults.") from None
        except re.error as e:
            raise BuildError(f'field_rules.jsonc has an invalid pattern "{e.pattern}": {e.msg}.') from None
        except (TypeError, AttributeError, ValueError) as e:
            raise BuildError(f"field_rules.jsonc has an entry with the wrong shape ({e}).") from None

    def _load(self, data):
        self.fields = [(f["id"], f["label"], f["count"], f["group"]) for f in data["fields"]]
        self.overrides = {t: field for field, tags in data["overrides"].items() for t in tags}
        self.overrides.update({t: None for t in data["drop_tags"]})
        self.drop = re.compile("^(?:" + "|".join(data["drop_patterns"]) + ")$")
        self.patterns = [(re.compile(p["pattern"]), p["field"]) for p in data["patterns"]]
        self.slot_to_field = data["slot_to_field"]
        self.fallback = [(re.compile(p["pattern"]), p["field"]) for p in data["fallback_patterns"]]
        self.group_to_field = [(g["group"], g["field"]) for g in data["group_to_field"]]
        self.jio7_to_field = data["jio7_to_field"]
        self.exclusive_groups = data["exclusive_groups"]
        self.not_identity = data["not_identity"]
        self.colors = data["colors"]
        ids = [f[0] for f in self.fields]
        if not ids:
            raise BuildError("field_rules.jsonc defines no fields.")
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise BuildError(f"field_rules.jsonc defines these fields twice: {', '.join(duplicates)}.")
        used = ({f for f in self.overrides.values() if f} | {f for _, f in self.patterns}
                | set(self.slot_to_field.values()) | {f for _, f in self.fallback}
                | {f for _, f in self.group_to_field} | set(self.jio7_to_field.values()))
        unknown = used - set(ids)
        if unknown:
            raise BuildError(f"field_rules.jsonc sends tags to fields it does not define: "
                             f"{', '.join(sorted(unknown))}. Add them to \"fields\" or fix the rules.")

    def classify(self, name, slot, wiki_groups, jio7=None):
        if name in self.overrides:
            return self.overrides[name]
        if self.drop.match(name):
            return None
        for pattern, field in self.patterns:
            if pattern.match(name):
                return field
        field = self.slot_to_field.get(slot)
        if field:
            return field
        if slot and slot.startswith("other:") and slot != "other:unclassified":
            return None
        for pattern, field in self.fallback:
            if pattern.match(name):
                return field
        for group, field in self.group_to_field:
            if group in wiki_groups:
                return field
        if name.startswith("holding_"):
            return "pose"
        return self.jio7_to_field.get(jio7)


# Download
def disk_full(where):
    return BuildError(f"The disk holding {where} is full. Free up some space or pick another download folder "
                      f"in Settings. Finished downloads are kept.")


def download_error(name, repo, path, error):
    if isinstance(error, urllib.error.HTTPError):
        if error.code == 404:
            return BuildError(f"{repo} no longer has {path} (HTTP 404). The data source has moved.")
        if error.code in (401, 403):
            return BuildError(f"Hugging Face refused to send {name} (HTTP {error.code}). The dataset {repo} may "
                              f"now require signing in or accepting its terms.")
        return BuildError(f"Downloading {name} failed with HTTP {error.code} {error.reason}. Try again later. "
                          f"Finished files are kept.")
    reason = getattr(error, "reason", None) or error
    return BuildError(f"Downloading {name} failed ({reason}). Check your internet connection and rebuild. "
                      f"The download picks up where it stopped.")


def remote_size(url):
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=30) as r:
            return int(r.headers.get("Content-Length") or 0)
    except (OSError, ValueError):
        return 0


def file_size(path):
    return os.path.getsize(path) if os.path.exists(path) else 0


def download_part(url, tmp, report):
    have = file_size(tmp)
    headers = {"User-Agent": USER_AGENT}
    if have:
        headers["Range"] = f"bytes={have}-"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
        if r.status != 206:
            have = 0
        length = int(r.headers.get("Content-Length") or 0)
        expected = have + length if length else 0
        got, last = have, 0.0
        with open(tmp, "ab" if have else "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
                got += len(chunk)
                if time.monotonic() - last >= PROGRESS_INTERVAL:
                    last = time.monotonic()
                    report(got)
    report(got)
    return not expected or got >= expected


def fetch(work, name, repo, path, report):
    url = HF.format(repo=repo, path=path)
    dest = os.path.join(work, name)
    tmp = dest + ".part"
    log("downloading", url, f"(resuming at {gb(file_size(tmp))})" if file_size(tmp) else "")
    error = None
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            if download_part(url, tmp, report):
                os.replace(tmp, dest)
                log(f"downloaded {name} ({gb(file_size(dest))})")
                return
            error = ConnectionError("the connection closed before the file was complete")
        except urllib.error.HTTPError as e:
            if e.code == 416 and file_size(tmp):
                os.replace(tmp, dest)
                return
            if e.code < 500 and e.code != 429:
                raise download_error(name, repo, path, e) from None
            error = e
        except OSError as e:
            if e.errno == 28:
                raise disk_full(work) from None
            error = e
        if attempt < DOWNLOAD_ATTEMPTS:
            log(f"{name}: {getattr(error, 'reason', None) or error}; retrying ({attempt + 1} of {DOWNLOAD_ATTEMPTS})")
            time.sleep(5 * attempt)
    raise download_error(name, repo, path, error)


def stage_download(work):
    pending = [(name, repo, path) for name, (repo, path) in SOURCES.items()
               if not os.path.exists(os.path.join(work, name))]
    if not pending:
        log("all source files are already downloaded")
        return
    progress(2, "Checking download size")
    sizes = {name: remote_size(HF.format(repo=repo, path=path)) for name, repo, path in pending}
    remaining = sum(max(0, sizes[name] - file_size(os.path.join(work, name + ".part"))) for name in sizes)
    need = remaining + DISK_MARGIN_BYTES
    free = shutil.disk_usage(work).free
    if free < need:
        raise BuildError(f"Not enough free space in {work}: the download needs about {gb(need)}, "
                         f"but only {gb(free)} is free. Free up space or pick another download folder in Settings.")
    total = sum(sizes.values()) if all(sizes.values()) else 0
    finished = 0
    for i, (name, repo, path) in enumerate(pending, 1):
        label = f"Downloading {name} ({i} of {len(pending)})"

        def report(got, label=label, name=name, finished=finished):
            if total:
                progress(2, label, finished + got, total, "bytes")
            else:
                progress(2, label, got, sizes[name] or None, "bytes")

        fetch(work, name, repo, path, report)
        finished += sizes[name] or file_size(os.path.join(work, name))


# Implications
def load_implications(work):
    imp = read_table(work, "tag_implications.parquet")
    implies = collections.defaultdict(set)
    for a, b, st in zip(imp["antecedent_name"], imp["consequent_name"], imp["status"]):
        if st == "active":
            implies[a].add(b)
    return implies


def transitive(implies):
    out = {}

    def walk(t, seen):
        stack = [t]
        while stack:
            for u in implies.get(stack.pop(), ()):
                if u not in seen:
                    seen.add(u)
                    stack.append(u)
        return seen

    for t in list(implies):
        out[t] = walk(t, set())
    return out


# Scan
def ranked(counts):
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))


def base_name(character_tag):
    return character_tag.split("_(", 1)[0]


_EMPTY = frozenset()
_COUNT_COLS = ["rating", "is_deleted", "tag_string_general", "tag_string_character", "tag_string_copyright"]
_STATS_COLS = ["score", *_COUNT_COLS]
POOL_RATINGS = "gsqe"
_SCAN = {}


def _value_counts(column):
    import pyarrow.compute as pc
    counts = pc.value_counts(pc.list_flatten(pc.split_pattern(pc.drop_null(column), " ")))
    out = dict(zip(counts.field("values").to_pylist(), counts.field("counts").to_pylist()))
    out.pop("", None)
    return out


def _live_rows(table):
    import pyarrow.compute as pc
    return table.filter(pc.invert(pc.fill_null(table["is_deleted"], False)))


def _count_chunk(args):
    path, groups = args
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as pq
    f = pq.ParquetFile(path)
    gen, gen_nsfw, cha, cop = (collections.Counter() for _ in range(4))
    nsfw_ratings = pa.array(["q", "e"])
    for g in groups:
        t = _live_rows(f.read_row_group(g, columns=_COUNT_COLS))
        general = t["tag_string_general"]
        gen.update(_value_counts(general))
        gen_nsfw.update(_value_counts(general.filter(pc.is_in(t["rating"], value_set=nsfw_ratings))))
        cha.update(_value_counts(t["tag_string_character"]))
        cop.update(_value_counts(t["tag_string_copyright"]))
    return gen, gen_nsfw, cha, cop


def _init_stats(state):
    import numpy as np
    import pyarrow as pa
    _SCAN.update(state)
    rules = state["rules"]
    gen_names = state["gen_names"]
    special = {"solo", *rules["alt_look_tags"], *rules["pool_exclude_tags"], *rules["count_tags"]}
    tag_vocab = gen_names + sorted(special - set(gen_names))
    index = {t: i for i, t in enumerate(tag_vocab)}

    def lookup(tags):
        flags = np.zeros(len(tag_vocab) + 1, bool)
        flags[[index[t] for t in tags]] = True
        return flags

    _SCAN.update(
        tag_vocab=pa.array(tag_vocab, type=pa.string()),
        char_names=pa.array(state["char_names"], type=pa.string()),
        cop_names=pa.array(state["cop_names"], type=pa.string()),
        n_gen=len(gen_names),
        solo_ids=lookup(["solo"]),
        alt_ids=lookup(rules["alt_look_tags"]),
        exclude_ids=lookup(rules["pool_exclude_tags"]),
        count_ids=[lookup([t]) for t in rules["count_tags"]],
    )


def _keep_top(heap, size, item):
    if len(heap) < size:
        heapq.heappush(heap, item)
    elif item > heap[0]:
        heapq.heapreplace(heap, item)


class Exploded:
    """Space-separated tag strings, one entry per tag, with the row each came from."""

    def __init__(self, column, vocabulary, rows, known_limit=None):
        import numpy as np
        import pyarrow.compute as pc
        lists = pc.split_pattern(column, " ")
        self.rows = rows
        self.parent = pc.list_parent_indices(lists).to_numpy()
        self.lengths = pc.list_value_length(lists).to_numpy()
        self.ids = pc.fill_null(pc.index_in(pc.list_flatten(lists), value_set=vocabulary), -1).to_numpy()
        known = (self.ids >= 0) if known_limit is None else (self.ids >= 0) & (self.ids < known_limit)
        self.known_parent = self.parent[known]
        self.known_ids = self.ids[known].astype(np.int64)
        self.known_counts = np.bincount(self.known_parent, minlength=rows)
        self.known_offsets = np.concatenate(([0], np.cumsum(self.known_counts)))

    def has_any(self, flags):
        import numpy as np
        return np.bincount(self.parent[flags[self.ids]], minlength=self.rows) > 0

    def known_of(self, row):
        return self.known_ids[self.known_offsets[row]:self.known_offsets[row + 1]]


def _pair_counts(left_rows, left_ids, right, width):
    import numpy as np
    lengths = right.known_counts[left_rows]
    total = int(lengths.sum())
    if not total:
        return np.empty(0, np.int64), np.empty(0, np.int64)
    starts = right.known_offsets[left_rows]
    index = np.repeat(starts - (np.cumsum(lengths) - lengths), lengths) + np.arange(total)
    keys = np.repeat(left_ids, lengths) * width + right.known_ids[index]
    return np.unique(keys, return_counts=True)


class PairCounts:
    """(left id, right id) counts kept as sorted int64 keys, summed across chunks."""

    def __init__(self, width, budget=20_000_000):
        self.width, self.budget = width, budget
        self.parts, self.size = [], 0

    def add(self, keys, counts):
        self.parts.append((keys, counts))
        self.size += len(keys)
        if self.size > self.budget:
            self.reduce()

    def reduce(self):
        import numpy as np
        if not self.parts:
            self.parts = [(np.empty(0, np.int64), np.empty(0, np.int64))]
        keys = np.concatenate([k for k, _ in self.parts])
        counts = np.concatenate([c for _, c in self.parts])
        unique, inverse = np.unique(keys, return_inverse=True)
        self.parts = [(unique, np.bincount(inverse, weights=counts).astype(np.int64))]
        self.size = len(unique)
        return self.parts[0]

    def by_left(self, rows):
        import numpy as np
        keys, counts = self.reduce()
        left, right = keys // self.width, keys % self.width
        return np.searchsorted(left, np.arange(rows + 1)), right, counts


def _one_person(names, char_implies):
    implied = set()
    for c in names:
        implied |= char_implies.get(c, _EMPTY)
    return len({base_name(c) for c in names if c not in implied}) == 1


def _stats_chunk(args):
    index, path, groups = args
    import numpy as np
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.parquet as pq
    s = _SCAN
    rules = s["rules"]
    n_gen, n_chars, n_cops = s["n_gen"], len(s["char_names"]), len(s["cop_names"])
    min_score, min_tags, pool_size = rules["pool_min_score"], rules["pool_min_general_tags"], rules["pool_size"]
    rng = random.Random(f"{rules['pool_seed']}:{index}")
    f = pq.ParquetFile(path)
    any_posts = np.zeros(n_chars, np.int64)
    canon_posts = np.zeros(n_chars, np.int64)
    out = dict(anyp=([], []), canon=([], []), series=([], []))
    pool = {r: [] for r in POOL_RATINGS}
    seq = 0
    for g in groups:
        t = _live_rows(f.read_row_group(g, columns=_STATS_COLS))
        t = t.filter(pc.not_equal(pc.fill_null(t["tag_string_general"], ""), "")).combine_chunks()
        rows = t.num_rows
        if not rows:
            continue
        column = lambda name: pc.fill_null(t.column(name), "").combine_chunks()
        tags = Exploded(column("tag_string_general"), s["tag_vocab"], rows, n_gen)
        chars = Exploded(column("tag_string_character"), s["char_names"], rows)
        cops = Exploded(column("tag_string_copyright"), s["cop_names"], rows)
        ratings = t.column("rating")
        solo = tags.has_any(s["solo_ids"])
        plain = ~tags.has_any(s["exclude_ids"])

        one_person = np.ones(rows, bool)
        multi = np.nonzero(chars.lengths >= 2)[0]
        if len(multi):
            names = t.column("tag_string_character").take(pa.array(multi)).to_pylist()
            one_person[multi] = [_one_person(n.split(" "), s["char_implies"]) for n in names]
        good_rating = pc.fill_null(pc.is_in(ratings, value_set=pa.array(["g", "s"])), False).to_numpy(
            zero_copy_only=False)
        canon_row = solo & plain & one_person & good_rating & ~tags.has_any(s["alt_ids"])

        c_rows, c_ids = chars.known_parent, chars.known_ids
        any_posts += np.bincount(c_ids, minlength=n_chars)
        canon_mask = canon_row[c_rows]
        canon_posts += np.bincount(c_ids[canon_mask], minlength=n_chars)
        for name, (rows_, ids_, right, width) in dict(
                anyp=(c_rows, c_ids, tags, n_gen),
                canon=(c_rows[canon_mask], c_ids[canon_mask], tags, n_gen),
                series=(c_rows, c_ids, cops, n_cops)).items():
            keys, counts = _pair_counts(rows_, ids_, right, width)
            out[name][0].append(keys)
            out[name][1].append(counts)

        scores = pc.fill_null(pc.cast(t.column("score"), pa.float64()), float("-inf")).to_numpy()
        count_hits = sum(tags.has_any(ids).astype(int) for ids in s["count_ids"])
        candidates = np.nonzero(solo & plain & (scores >= min_score) & (tags.lengths >= min_tags)
                                & (count_hits == 1))[0]
        candidate_ratings = ratings.take(pa.array(candidates)).to_pylist() if len(candidates) else []
        for row, rating in zip(candidates.tolist(), candidate_ratings):
            heap = pool.get(rating)
            if heap is None:
                continue
            seq += 1
            key = max(float(scores[row]), 0.0) ** 0.5 * rng.random()
            _keep_top(heap, pool_size[rating], (key, index, seq, tags.known_of(row).astype(np.uint32)))

    def joined(parts):
        keys, counts = parts
        if not keys:
            return np.empty(0, np.int64), np.empty(0, np.int64)
        return np.concatenate(keys), np.concatenate(counts)

    return any_posts, canon_posts, {k: joined(v) for k, v in out.items()}, pool


def stage_scan(work, jobs, rules_data, settings, implied):
    import multiprocessing as mp
    import pyarrow.parquet as pq

    path = os.path.join(work, "posts.parquet")
    try:
        n_groups = pq.ParquetFile(path).metadata.num_row_groups
    except Exception as e:
        raise BuildError(f"posts.parquet could not be read ({e}). Use Delete downloads in Settings, then rebuild "
                         f"to download it again.") from None
    chunks = [list(range(i, min(i + 3, n_groups))) for i in range(0, n_groups, 3)]

    def report(label, i):
        progress(3, label, i, len(chunks), "chunks")
        if i % 10 == 0 or i == len(chunks):
            log(f"  {label}: {i}/{len(chunks)}")

    log(f"scanning posts with {jobs} worker processes")
    gen, gen_nsfw, cha, cop = (collections.Counter() for _ in range(4))
    report("Counting tags (pass 1 of 2)", 0)
    with mp.Pool(jobs) as pool:
        for i, r in enumerate(pool.imap_unordered(_count_chunk, [(path, c) for c in chunks]), 1):
            for total, part in zip((gen, gen_nsfw, cha, cop), r):
                total.update(part)
            report("Counting tags (pass 1 of 2)", i)

    gen_names = [t for t, n in ranked(gen) if n >= settings["min_general_count"]]
    char_names = [t for t, n in ranked(cha) if n >= settings["min_character_count"]]
    if not gen_names or not char_names:
        raise BuildError("No tag or character reaches min_general_count / min_character_count. "
                         "Lower them in build_settings.jsonc.")
    log(f"  {len(gen_names)} general tags, {len(char_names)} characters")

    char_implies = {c: frozenset(u for u in implied.get(c, ()) if u in cha) for c in cha if c in implied}
    cop_names = sorted(cop)

    report("Collecting character statistics (pass 2 of 2)", 0)
    import numpy as np
    any_posts = np.zeros(len(char_names), np.int64)
    canon_posts = np.zeros(len(char_names), np.int64)
    pairs = dict(anyp=PairCounts(len(gen_names)), canon=PairCounts(len(gen_names)),
                 series=PairCounts(len(cop_names)))
    pool_posts = {r: [] for r in POOL_RATINGS}
    scan_rules = dict(alt_look_tags=rules_data["alt_look_tags"],
                      pool_exclude_tags=rules_data["pool_exclude_tags"],
                      count_tags=settings["count_tags"],
                      pool_min_score=settings["pool_min_score"],
                      pool_min_general_tags=settings["pool_min_general_tags"],
                      pool_size=settings["pool_size"],
                      pool_seed=settings["pool_seed"])
    state = dict(gen_names=gen_names, char_names=char_names, cop_names=cop_names,
                 char_implies=char_implies, rules=scan_rules)

    with mp.Pool(jobs, initializer=_init_stats, initargs=(state,)) as pool:
        work_items = [(i, path, c) for i, c in enumerate(chunks)]
        for i, (r_any, r_canon, r_pairs, r_pool) in enumerate(pool.imap_unordered(_stats_chunk, work_items), 1):
            any_posts += r_any
            canon_posts += r_canon
            for name, (keys, counts) in r_pairs.items():
                pairs[name].add(keys, counts)
            for rating, items in r_pool.items():
                for item in items:
                    _keep_top(pool_posts[rating], settings["pool_size"][rating], item)
            report("Collecting character statistics (pass 2 of 2)", i)

    log("scan done")
    return dict(gen_names=gen_names, gen_count=[gen[t] for t in gen_names],
                gen_nsfw=[gen_nsfw[t] for t in gen_names],
                char_names=char_names, char_count=[cha[t] for t in char_names],
                series_count={t: n for t, n in cop.items() if n >= settings["min_series_count"]},
                cop_names=cop_names, any_posts=any_posts, canon_posts=canon_posts,
                pairs=pairs, pool=pool_posts)


# Build
def load_side_tables(work):
    tax = read_table(work, "taxonomy.parquet")
    slots, aliases, renamed = {}, {}, {}
    for tag, cat, slot, al in zip(tax["tag"], tax["danbooru_category"], tax["slot"], tax["aliases"]):
        if cat == "general":
            slots[tag] = slot
        al = [a for a in (al or ()) if a]
        aliases[(cat, tag)] = al
        for a in al:
            renamed[(cat, a)] = tag
    for (cat, new), old in renamed.items():
        if (cat, new) in aliases:
            continue
        aliases[(cat, new)] = [old] + [a for a in aliases[(cat, old)] if a != new]
        if cat == "general" and old in slots:
            slots[new] = slots[old]
    grp = read_table(work, "tag_groups.parquet")
    groups = collections.defaultdict(set)
    for g, t in zip(grp["tag_group"], grp["tag"]):
        groups[t].add(g.split(":", 1)[1])
    jio7 = {}
    for cat in JIO7_CATEGORIES:
        with open(os.path.join(work, f"jio7_{cat}.csv"), encoding="utf8") as f:
            for line in f:
                jio7.setdefault(line.rsplit(",", 1)[0].strip().strip('"'), cat)
    return slots, aliases, groups, jio7


def stage_build(work, out_dir, report_path, rules, settings, scan, implied):
    import numpy as np

    progress(4, "Reading tag taxonomy and groups")
    slots, aliases, groups, jio7 = load_side_tables(work)

    gen_names, gen_count, gen_nsfw = scan["gen_names"], scan["gen_count"], scan["gen_nsfw"]
    field_index = {field[0]: i for i, field in enumerate(rules.fields)}

    progress(4, "Sorting tags into fields")
    tags, remap, report = [], {}, collections.defaultdict(list)
    for old, (name, count, nsfw) in enumerate(zip(gen_names, gen_count, gen_nsfw)):
        field = rules.classify(name, slots.get(name), groups.get(name, ()), jio7.get(name))
        report[field or "-"].append(name)
        if field is None:
            continue
        remap[old] = len(tags)
        tags.append([name, field_index[field], count, round(nsfw / count, 2)])
    if not tags:
        raise BuildError("field_rules.jsonc leaves out every tag. Check drop_tags and drop_patterns.")
    if len(tags) > 65535:
        raise BuildError(f"{len(tags)} tags were kept, more than the database can hold (65,535). "
                         f"Raise min_general_count in build_settings.jsonc.")
    tag_id = {t[0]: i for i, t in enumerate(tags)}
    log(f"{len(tags)} of {len(gen_names)} general tags assigned to fields")
    with open(report_path, "w", encoding="utf8") as f:
        for field, names in report.items():
            f.write(f"== {field} ({len(names)})\n" + " ".join(names) + "\n\n")

    imp_out = {}
    for t, i in tag_id.items():
        parents = sorted(tag_id[u] for u in implied.get(t, ()) if u in tag_id)
        if parents:
            imp_out[i] = parents

    groups_out = {}
    for gname, g in rules.exclusive_groups.items():
        groups_out[gname] = dict(tags=[tag_id[m] for m in g["tags"] if m in tag_id],
                                 multi=[tag_id[m] for m in g["multi"] if m in tag_id])

    general_aliases = {}
    for t, i in tag_id.items():
        al = [a for a in aliases.get(("general", t), ()) if a != t and not a.startswith("/")]
        if al:
            general_aliases[i] = al[:6]

    series_count = scan["series_count"]
    series_parents = {s: {p for p in implied.get(s, ()) if p in series_count} for s in series_count}

    def pick_series(counter, n_posts):
        best = [s for s, n in ranked(counter)[:8] if s in series_count and n >= 0.5 * n_posts]
        if not best:
            best = [s for s, _n in ranked(counter)[:1] if s in series_count]
        if not best:
            return None
        parents = set().union(*(series_parents[s] for s in best))
        specific = [s for s in best if s not in parents]
        return (specific or best)[0]

    progress(4, "Building character looks")
    characters, char_ptr, char_tags, char_pct = [], [0], [], []
    n_canon = 0
    n_chars = len(scan["char_names"])
    any_posts, canon_posts = scan["any_posts"], scan["canon_posts"]
    stats = {name: scan["pairs"][name].by_left(n_chars) for name in ("anyp", "canon", "series")}
    cop_names = scan["cop_names"]
    for cid, (name, count) in enumerate(zip(scan["char_names"], scan["char_count"])):
        clean = 0 < canon_posts[cid] and canon_posts[cid] >= settings["canon_min_posts"]
        if clean:
            n_canon += 1
        elif not any_posts[cid]:
            continue
        n = int(canon_posts[cid] if clean else any_posts[cid])
        bounds, olds, counts = stats["canon" if clean else "anyp"]
        olds, counts = olds[bounds[cid]:bounds[cid + 1]], counts[bounds[cid]:bounds[cid + 1]]
        frequent = counts / n >= settings["char_min_freq"]
        per_field = collections.defaultdict(list)
        for old, c in zip(olds[frequent].tolist(), counts[frequent].tolist()):
            new = remap.get(old)
            if new is not None:
                per_field[tags[new][1]].append((c / n, new))
        flat = []
        for items in per_field.values():
            items.sort(reverse=True)
            flat.extend([new, round(freq * 100)] for freq, new in items[:settings["char_tags_per_field"]])
        flat.sort(key=lambda x: (-x[1], x[0]))
        bounds, cops, cop_counts = stats["series"]
        ser = {cop_names[k]: c for k, c in zip(cops[bounds[cid]:bounds[cid + 1]].tolist(),
                                               cop_counts[bounds[cid]:bounds[cid + 1]].tolist())}
        series_name = pick_series(ser, int(any_posts[cid])) if ser else None
        al = [a for a in aliases.get(("character", name), ()) if a != name][:4]
        characters.append([name, count, series_name or "", al, int(clean)])
        char_tags.extend(x[0] for x in flat)
        char_pct.extend(x[1] for x in flat)
        char_ptr.append(len(char_tags))
    log(f"{len(characters)} characters ({n_canon} with clean solo statistics)")

    progress(4, "Building the dice picture pool")
    indptr, flat_ids, ratings = [0], [], []
    for r_index, rating in enumerate(POOL_RATINGS):
        for *_, ids in sorted(scan["pool"][rating], reverse=True):
            new = sorted({remap[i] for i in ids.tolist() if i in remap})
            if len(new) < settings["pool_min_kept_tags"]:
                continue
            flat_ids.extend(new)
            indptr.append(len(flat_ids))
            ratings.append(r_index)
    log(f"{len(ratings)} pool posts, {len(flat_ids)} tags")
    if not ratings:
        raise BuildError("No picture qualifies for the dice pool. Lower pool_min_score, pool_min_general_tags "
                         "or pool_min_kept_tags in build_settings.jsonc.")

    progress(4, "Writing database files")
    os.makedirs(out_dir, exist_ok=True)
    meta = dict(
        built=time.strftime("%Y-%m-%d"),
        fields=[dict(id=i, label=label, count=count, group=group) for i, label, count, group in rules.fields],
        tags=tags,
        implies=imp_out,
        groups=groups_out,
        soft=sorted(tag_id[t] for t in rules.not_identity if t in tag_id),
        colors=rules.colors,
        aliases=general_aliases,
        series=[[s, n] for s, n in ranked(series_count)],
    )

    def dump(name, obj):
        p = os.path.join(out_dir, name)
        with gzip.GzipFile(p, "wb", compresslevel=9, mtime=0) as f:
            f.write(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf8"))
        log(f"wrote {name}: {os.path.getsize(p) / 1e6:.2f} MB")

    dump("tags.json.gz", meta)
    dump("characters.json.gz", characters)
    p = os.path.join(out_dir, "character_tags.npz")
    np.savez_compressed(p, indptr=np.asarray(char_ptr, dtype=np.uint32),
                        tags=np.asarray(char_tags, dtype=np.uint16),
                        percent=np.asarray(char_pct, dtype=np.uint8))
    log(f"wrote character_tags.npz: {os.path.getsize(p) / 1e6:.2f} MB")
    p = os.path.join(out_dir, "posts.npz")
    np.savez_compressed(p, indptr=np.asarray(indptr, dtype=np.uint32),
                        tags=np.asarray(flat_ids, dtype=np.uint16),
                        rating=np.asarray(ratings, dtype=np.uint8))
    log(f"wrote posts.npz: {os.path.getsize(p) / 1e6:.2f} MB")
    return dict(tags=len(tags), characters=len(characters), posts=len(ratings))


def run(a):
    started = time.monotonic()
    progress(1, "Checking config and Python packages")
    rules_data = load_json(a.rules)
    settings = load_json(a.settings)
    check_settings(settings)
    rules = Rules(rules_data)
    jobs = int(settings["jobs"]) or max(1, min(4, os.cpu_count() or 1))
    ensure_packages()
    memory = available_memory()
    if memory is not None and memory < RECOMMENDED_RAM_BYTES:
        warn(f"Only {gb(memory)} of RAM is free and the scan needs about {gb(RECOMMENDED_RAM_BYTES)}. "
             f"Close other apps (ComfyUI too) or set \"jobs\" to 1 in build_settings.jsonc if it fails.")
    stage_download(a.work)
    progress(3, "Reading tag implications")
    implied = transitive(load_implications(a.work))
    scan = stage_scan(a.work, jobs, rules_data, settings, implied)
    summary = stage_build(a.work, a.out, a.report, rules, settings, scan, implied)
    summary["seconds"] = round(time.monotonic() - started)
    emit("summary", summary)
    log("done")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--settings", required=True)
    ap.add_argument("--report", required=True)
    a = ap.parse_args()
    try:
        run(a)
    except BuildError as e:
        message = str(e)
    except MemoryError:
        message = ("Ran out of memory. Close other apps (ComfyUI too), set \"jobs\" to 1 in "
                   "build_settings.jsonc, or enlarge the Windows page file, then rebuild.")
    except OSError as e:
        if e.errno != 28:
            traceback.print_exc()
        message = str(disk_full(a.work)) if e.errno == 28 else f"File error: {e}"
    except Exception as e:
        traceback.print_exc()
        message = f"Unexpected error: {type(e).__name__}: {e}"
    else:
        return
    emit("error", message)
    sys.exit(1)


if __name__ == "__main__":
    main()
