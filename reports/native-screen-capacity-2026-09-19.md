# Native screen capacity — September 19, 2026

The native core accepts up to 32 simultaneous screen outputs within its existing 512 MiB render/export texture budget. Rejection is atomic: existing outputs remain configured and their textures stay live. Duplicate/missing IDs and malformed arrays are rejected. Batch summaries expose screen errors and count rejected commands as dropped. The Screens panel presents errors and clears them after an accepted update.

Validation:
- Rust admission test passed: 32×1080p and 8×4K accepted arithmetically; 33 outputs and 9×4K rejected; empty list, duplicate IDs, missing IDs and malformed payload checked.
- Mac Metal runtime test passed: 32 separate 64×64 IOSurface outputs each produced frames and handles; rejected count/memory/duplicate requests preserved all outputs; removal to two/zero retired textures.
- 62 renderer-sync tests passed, including rejection-message display state and clearing after success.
- Desktop check: zero errors, 1038 existing warnings.
- Mac release build and Windows compiler check passed.
- Existing Screens panel opens correctly in the development app. The rejection banner itself was covered by state tests but not visually triggered in the app.

Limits: no 32-projector/full-resolution throughput claim, no Windows runtime claim, no direct Windows screen/deck-window implementation in this step. Budget estimates cover the existing two RGBA output textures per screen, not all GPU resources. No release or commit made.
