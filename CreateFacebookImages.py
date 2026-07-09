import json
import os
from PIL import Image, ImageDraw, ImageFont

# Paths
JSONL_PATH = r"J:\GitHub\CD-Catalog\catalog.jsonl"
COVER_PATH = r"J:\GitHub\CD-Catalog\400x400covers"
OUTPUT_PATH = r"J:\GitHub\CD-Catalog\FB_Upload_Ready"

# Fonts (scaled to match your original layout)
FONT_PATH = r"C:\Windows\Fonts\YuGothR.ttc"
TITLE_FONT = ImageFont.truetype(FONT_PATH, 32)
META_FONT  = ImageFont.truetype(FONT_PATH, 20)
DESC_FONT  = ImageFont.truetype(FONT_PATH, 20)   # same size as metadata

# Spacing
TITLE_SPACING = 36
META_SPACING  = 26
DESC_SPACING  = 26

# Title color (dark grey-blue)
TITLE_COLOR = (40, 60, 90)

# ---------------------------------------------------------
# Normalize dashes (fixes □ glyph issue)
# ---------------------------------------------------------
def normalize_dashes(text):
    return (
        text.replace("–", "-")
            .replace("—", "-")
            .replace("−", "-")
    )

# ---------------------------------------------------------
# Price formatting helper
# ---------------------------------------------------------
def format_price(value):
    try:
        num = float(value)
    except:
        return value  # fallback if unexpected

    # If it's effectively an integer (14.0, 14.00, 14.)
    if num.is_integer():
        return str(int(num))

    # Otherwise force two decimals
    return f"{num:.2f}"

# ---------------------------------------------------------
# Delete all existing files in FB_Upload_Ready
# ---------------------------------------------------------
def clear_output_folder():
    if os.path.exists(OUTPUT_PATH):
        for filename in os.listdir(OUTPUT_PATH):
            file_path = os.path.join(OUTPUT_PATH, filename)
            if os.path.isfile(file_path):
                os.remove(file_path)
        print("Cleared FB_Upload_Ready folder.")
    else:
        os.makedirs(OUTPUT_PATH)
        print("Created FB_Upload_Ready folder.")

# ---------------------------------------------------------
# Word wrap helper
# ---------------------------------------------------------
def wrap_text(text, font, max_width, draw):
    words = text.split()
    lines = []
    current = ""

    for word in words:
        test = current + " " + word if current else word
        if draw.textlength(test, font=font) <= max_width:
            current = test
        else:
            lines.append(current)
            current = word

    if current:
        lines.append(current)

    return lines

# ---------------------------------------------------------
# Create a Facebook-ready image for one JSONL entry
# ---------------------------------------------------------
def create_fb_image(entry):

    # Use Unique CD Number for filenames
    catalog = entry["Unique CD Number"]

    cover_file = os.path.join(COVER_PATH, f"{catalog}_cover.jpg")
    output_file = os.path.join(OUTPUT_PATH, f"{catalog}.jpg")

    if not os.path.exists(cover_file):
        print(f"Missing cover: {cover_file}")
        return

    # Load 400x400 cover
    cover = Image.open(cover_file).convert("RGB")

    # Create final canvas (1200x600)
    canvas = Image.new("RGB", (1200, 600), "white")
    draw = ImageDraw.Draw(canvas)

    # -----------------------------------------------------
    # LEFT COLUMN (cover only)
    # -----------------------------------------------------
    canvas.paste(cover, (0, 0))

    # -----------------------------------------------------
    # RIGHT COLUMN
    # -----------------------------------------------------
    x = 460
    y = 20
    wrap_width = 700   # corrected so text stays inside 1200px canvas

    # -----------------------------
    # Title (wraps like metadata)
    # -----------------------------
    title = normalize_dashes(entry["Title"])
    title_parts = title.split(" -- ")

    for part in title_parts:
        wrapped = wrap_text(part, TITLE_FONT, wrap_width, draw)
        for line in wrapped:
            draw.text((x, y), line, fill=TITLE_COLOR, font=TITLE_FONT)
            y += TITLE_SPACING

    # -----------------------------
    # Series
    # -----------------------------
    text = normalize_dashes(f"Series: {entry['Series']}")
    wrapped = wrap_text(text, META_FONT, wrap_width, draw)
    for line in wrapped:
        draw.text((x, y), line, fill="black", font=META_FONT)
        y += META_SPACING

    # -----------------------------
    # Catalog Number
    # -----------------------------
    text = normalize_dashes(f"Catalog #: {entry['CatalogNumber']}")
    wrapped = wrap_text(text, META_FONT, wrap_width, draw)
    for line in wrapped:
        draw.text((x, y), line, fill="black", font=META_FONT)
        y += META_SPACING

    # -----------------------------
    # Label + Year
    # -----------------------------
    text = normalize_dashes(f"Label: {entry['Label']} ({entry['Year']})")
    wrapped = wrap_text(text, META_FONT, wrap_width, draw)
    for line in wrapped:
        draw.text((x, y), line, fill="black", font=META_FONT)
        y += META_SPACING

    # -----------------------------
    # Runtime
    # -----------------------------
    text = normalize_dashes(f"Runtime: {entry['Runtime']}")
    wrapped = wrap_text(text, META_FONT, wrap_width, draw)
    for line in wrapped:
        draw.text((x, y), line, fill="black", font=META_FONT)
        y += META_SPACING

    # -----------------------------
    # Price (formatted)
    # -----------------------------
    price = format_price(entry["Price"])
    text = normalize_dashes(f"Price: ${price}")
    wrapped = wrap_text(text, META_FONT, wrap_width, draw)
    for line in wrapped:
        draw.text((x, y), line, fill="black", font=META_FONT)
        y += META_SPACING

    # -----------------------------
    # Condition
    # -----------------------------
    text = normalize_dashes(f"Condition: {entry['Condition']}")
    wrapped = wrap_text(text, META_FONT, wrap_width, draw)
    for line in wrapped:
        draw.text((x, y), line, fill="black", font=META_FONT)
        y += META_SPACING

    # -----------------------------------------------------
    # DESCRIPTION (full-width, wrapping at 1150px)
    # -----------------------------------------------------
    desc_x = 20
    desc_y = 420
    desc_width = 1150

    desc_text = normalize_dashes(entry["Description"])
    desc_lines = wrap_text(desc_text, DESC_FONT, desc_width, draw)

    for line in desc_lines:
        draw.text((desc_x, desc_y), line, fill="black", font=DESC_FONT)
        desc_y += DESC_SPACING

    # Save final image
    canvas.save(output_file, "JPEG", quality=92)
    print(f"Created: {output_file}")

# ---------------------------------------------------------
# Main
# ---------------------------------------------------------
def main():
    clear_output_folder()

    with open(JSONL_PATH, "r", encoding="utf-8") as f:
        for line in f:
            entry = json.loads(line)
            create_fb_image(entry)

if __name__ == "__main__":
    main()