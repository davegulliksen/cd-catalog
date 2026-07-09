# CopyPropertiesToTrackZero.py
# Copies specified metadata fields from an album FLAC file to the
# corresponding 0TrackZero file, keyed by NUMBERONLY (folder/filename stem).
# Only writes fields present in the source; leaves all other 0TrackZero fields untouched.

from pathlib import Path
from mutagen.flac import FLAC

ALBUM_ROOT     = Path(r"L:\Users\fran\Music\Foobar2000 flac")
ZERO_TRACK_DIR = Path(r"L:\Users\fran\Music\0TrackZero")

# Fields to copy from album FLAC to 0TrackZero file
FIELDS_TO_COPY = [
    "ALBUM",
    "CATALOGNUMBER",
    "RAWNUMBER",
    "ALBUM ARTIST",
    "ALBUMHEADER",
    "SUBTITLE",
    "PRICE",
    "DATEINCATALOG",
]

for artist_folder in ALBUM_ROOT.iterdir():
    if not artist_folder.is_dir():
        continue

    for album_folder in artist_folder.iterdir():
        if not album_folder.is_dir():
            continue

        stem = album_folder.name
        zero_track_file = ZERO_TRACK_DIR / f"{stem}.flac"

        if not zero_track_file.exists():
            print(f"WARNING: No 0TrackZero file found for {stem} — skipping")
            continue

        source_flac = next(album_folder.glob("*.flac"), None)
        if not source_flac:
            print(f"Skipping {stem} — no FLAC found in album folder")
            continue

        print(f"Processing: {stem}")

        source_audio = FLAC(source_flac)
        zero_audio   = FLAC(zero_track_file)
        changed      = False

        for field in FIELDS_TO_COPY:
            source_value = source_audio.get(field)
            if source_value:
                if zero_audio.get(field) != source_value:
                    zero_audio[field] = source_value
                    print(f"  {field} -> {source_value[0]}")
                    changed = True

        if changed:
            zero_audio.save()
        else:
            print(f"  No changes")