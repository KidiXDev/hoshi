import json
import re
import sys
from itertools import islice
from pathlib import Path

import pygit2

MAX_COMMITS = 30

pygit2.option(pygit2.GIT_OPT_SET_OWNER_VALIDATION, 0)
repo_path = Path(sys.argv[1])
repo = pygit2.Repository(str(repo_path))
repo.remotes["origin"].fetch()

local = repo.head.peel(pygit2.Commit)
remote = repo.lookup_reference("refs/remotes/origin/master").peel(pygit2.Commit)
ahead, behind = repo.ahead_behind(local.id, remote.id)

walker = repo.walk(remote.id)
walker.hide(local.id)

version_file = repo_path / "comfyui_version.py"
version = (
    re.search(r'__version__\s*=\s*"([^"]+)"', version_file.read_text(encoding="utf-8"))
    if version_file.is_file()
    else None
)


def summary(commit):
    return (commit.message.strip().splitlines() or [""])[0]


print(
    json.dumps(
        {
            "version": version.group(1) if version else "",
            "branch": "" if repo.head_is_detached else repo.head.shorthand,
            "commit": str(local.id),
            "remoteCommit": str(remote.id),
            "ahead": ahead,
            "behind": behind,
            "commits": [
                {
                    "id": str(commit.id),
                    "summary": summary(commit),
                    "author": commit.author.name,
                    "timestamp": commit.commit_time * 1000,
                }
                for commit in islice(walker, MAX_COMMITS)
            ],
        }
    )
)
