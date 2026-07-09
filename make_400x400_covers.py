# -----------------------------
# CREATED BY COPILOT 3/21/2026
# MAKES MAX 400x400 %NUMBERONLY%_cover.jpg FILES
# python make_400x400_covers.py --no-overwrite
# OR
# python make_400x400_covers.py --overwrite
# -----------------------------

import os
import argparse
from pathlib import Path
from PIL import Image
from mutagen.flac import FLAC

# -----------------------------
# CONFIGURATION
# -----------------------------
ROOT = Path(r"L:\Users\fran\Music\Foobar2000 flac")
TARGET_SIZE = 400          # longest side becomes this size
COVER_NAME = "cover.jpg"
SCANNED_FOLDER = "scanned"
TAG_NAME = "NUMBERONLY"    # Foobar2000 custom tag

# NEW DESTINATION FOLDER
DEST = Path(r"J:\GitHub\CD-Catalog\400x400covers")
# -----------------------------


def resize_proportional(input_path: Path, output_path: Path, max_size: int):
    """Resize an image so the longest side = max_size, preserving aspect ratio."""
    img = Image.open(input_path)
    w, h = img.size

    if w >= h:
        new_w = max_size
        new_h = int(h * (max_size / w))
    else:
        new_h = max_size
        new_w = int(w * (max_size / h))

    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    resized.save(output_path, "JPEG", quality=95)


def extract_numberonly(flac_path: Path):
    """Extract the Foobar2000 %NUMBERONLY% tag from a FLAC file."""
    try:
        audio = FLAC(flac_path)
        if TAG_NAME in audio:
            return audio[TAG_NAME][0].strip()
    except Exception:
        pass
    return None


def process_album(folder: Path, overwrite: bool):
    """Process a single album folder according to your rules."""
    cover_path = folder / COVER_NAME
    scanned_path = folder / SCANNED_FOLDER

    # Rule 1: must contain cover.jpg
    if not cover_path.exists():
        return

    # Rule 2: must contain scanned subfolder
    if not scanned_path.exists():
        return

    # Rule 3: must contain at least one FLAC
    flacs = list(folder.glob("*.flac"))
    if not flacs:
        return

    # Extract NUMBERONLY from first FLAC
    numberonly = extract_numberonly(flacs[0])
    if not numberonly:
        return

    # NEW OUTPUT LOCATION
    output_file = DEST / f"{numberonly}_cover.jpg"

    # Overwrite behavior
    if output_file.exists() and not overwrite:
        return

    print(f"Processing: {folder} → {output_file.name}")

    # Resize and save
    resize_proportional(cover_path, output_file, TARGET_SIZE)


def main():
    parser = argparse.ArgumentParser(description="Generate XXX_cover.jpg images.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--overwrite", action="store_true", help="Overwrite existing files")
    group.add_argument("--no-overwrite", action="store_true", help="Do not overwrite existing files")

    args = parser.parse_args()

    # Default: no overwrite unless explicitly requested
    overwrite = args.overwrite

    print(f"Overwrite mode: {overwrite}")
    print("Starting scan...")

    for root, dirs, files in os.walk(ROOT):
        folder = Path(root)
        process_album(folder, overwrite)

    print("Done.")


if __name__ == "__main__":
    main()