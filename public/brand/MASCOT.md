# YuiSync mascot

The mascot is an abstract jellyfish built from two IP colors and six primary shapes. Its two large side folds wrap around the cyan core and preserve the silhouette of the selected A2 concept.

## Assets

- `yuisync-mascot.svg`: transparent master mark for product UI and the website.
- `yuisync-mascot-avatar.svg`: parchment-backed, corner-cropped social avatar.
- `yuisync-mascot-favicon.svg`: simplified small-size icon.
- `yuisync-mascot-touch.png`: 180 px touch icon generated from the avatar artwork.
- `yuisync-mascot-mono.svg`: one-ink version for documents and restricted contexts.

## Palette

- Deep navy: `#0D2340`
- Sync cyan: `#2AA8C9`
- Parchment: `#F4F0E8`

## Motion

The React `YuiMascot` component animates the two folds in sequence, then lets the face compress and the whole shape float by three pixels. Motion is disabled when `prefers-reduced-motion` is active.

Use the animated form as a hero accent, loading state, or isolated product moment. Keep navigation, dense tables, and repeated lists static.
