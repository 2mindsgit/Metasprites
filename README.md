## METASPRITES Editor

**METASPRITES Editor** is a standalone HTML/CSS/JavaScript web application designed to create, edit, preview, and export metasprites for the **Sega Master System** and **Game Gear**.

The tool runs entirely in the browser and does not require any server-side processing. It allows indexed PNG sprite sheets to be imported, sliced into frames, organized into animations, optimized into a tile bank, and exported for use in assembly or DevkitSMS projects.

**Online version** https://metasprites.2minds.fr/

<img width="1070" height="756" alt="metasprites2" src="https://github.com/user-attachments/assets/329d4160-8065-48db-9048-4c0695772687" />
<img width="1640" height="791" alt="metasprites" src="https://github.com/user-attachments/assets/7c8fba7f-54c5-4a0d-8dac-dafa3bf74eed" />

### Main Features

* Import indexed PNG sprite sheets with up to 16 colors.
* Support for 8×8 and 8×16 tile modes.
* Automatic sprite sheet slicing, with optional simple grid-based cutting.
* Ignore empty frames using color index 0 as transparency.
* Create, edit, clone, import, reorder, move, and delete frames.
* Organize frames into multiple animations.
* Drag and drop animations and frames using grip handles.
* Visual frame numbering directly on the sprite sheet.
* Display tile usage per frame, animation, or preview step.
* Generate a deduplicated tile bank from real frames only.
* Exclude virtual/imported clone references from physical tile generation.
* Highlight tile occurrences on hover.
* Show tile occurrence count and occupancy information.
* Detect low-occupancy tiles with an adjustable threshold.
* Preview animations directly in the browser.
* Adjustable transparency for color index 0 in the preview.
* Optional block and frame outlines in the preview.
* Display tile count and maximum sprite width warnings.
* Support automatic mirror generation.
* Export tile graphics as PNG sprite sheets, raw BIN data, PSGaiden, or ZX7 compressed data.
* Export metasprite and animation data as ASM (WLA-DX) or DevkitSMS-compatible (`.c` and `.h` files). 
* Multi-language interface with French and English support.

### Export Formats

SMS Metasprite Editor can export tile graphics and metasprite data in several formats:

* **PNG** sprite sheet export.
* **BIN** raw tile data export.
* **PSGaiden** compressed tile data export.
* **ZX7** compressed tile data export.
* **ASM** metasprite data export.
* **DevkitSMS** `.c` and `.h` source export.

### Intended Use

This editor is intended for Sega Master System homebrew projects that need a practical visual workflow for preparing metasprites, animation frames, tile data, and export-ready source files.

It is especially useful when working with indexed PNG sprite sheets and when optimizing sprite animations under hardware constraints such as tile count, sprite width, and VRAM transfer limits.
