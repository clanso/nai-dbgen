#!/usr/bin/env python3
"""打 SillyTavern 第三方扩展包。解压后得到 nai-dbgen/，拷进用户 extensions 目录。"""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "nai-dbgen.zip"
FOLDER = "nai-dbgen"

INCLUDE_FILES = (
    "manifest.json",
    "index.js",
    "style.css",
)
INCLUDE_DIRS = (
    "src",
    "assets/seed",
)


def main():
    missing = [name for name in INCLUDE_FILES if not (ROOT / name).is_file()]
    missing += [name for name in INCLUDE_DIRS if not (ROOT / name).is_dir()]
    if missing:
        raise SystemExit("缺少: " + ", ".join(missing))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name in INCLUDE_FILES:
            zf.write(ROOT / name, f"{FOLDER}/{name}")
            count += 1
        for directory in INCLUDE_DIRS:
            base = ROOT / directory
            for path in sorted(base.rglob("*")):
                if not path.is_file() or path.name.startswith("."):
                    continue
                rel = path.relative_to(ROOT).as_posix()
                zf.write(path, f"{FOLDER}/{rel}")
                count += 1
    print(f"{OUT} ({count} files)")


if __name__ == "__main__":
    main()
