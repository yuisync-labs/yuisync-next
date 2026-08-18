# Frontend compatibility debt

YuiSync Next still contains transitional frontend calls through the Supabase-shaped compatibility facade while the Cloudflare/D1-native surface is expanded. This document records the policy for that debt; the exact executable inventory lives in `frontend-compat-surface.json`.

## Ratchet rule

The current inventory is a ceiling, never a target.

- Existing `.from()` and `.rpc()` calls may remain temporarily where the native Cloudflare API has not replaced them yet.
- A pull request may reduce those counts.
- A pull request may not increase either count in any existing file.
- A new source file starts with a zero allowance; adding compatibility calls to it is rejected.
- When code removes compatibility calls, the inventory must be regenerated in the same change, permanently lowering the ceiling.
- Updating the inventory cannot authorize new debt: CI compares it with the base branch and rejects increases.

## Current priority order

1. Compatibility mutations before reads.
2. Package, appointment, billing, checkout and financial paths before low-risk catalog reads.
3. Shared domain hooks before leaf presentation helpers.
4. Remove an inventory entry as soon as its native API replaces the final compatibility call.

`PlanosNativePage` is intentionally outside this debt after the native-command hardening: its critical mutations must remain behind the plan command boundary. `planCommands.js` may still contain transitional appointment read/reschedule compatibility until the corresponding native appointment command replaces it; the ratchet prevents that surface from growing.

## CI

`check:frontend-compat-ratchet` recomputes the source inventory, requires the checked-in JSON to match the code exactly, and compares that inventory to the pull-request base. Any increase fails Quality.

This ratchet complements the Edge compatibility surface gate; it does not replace the long-term task of deleting the compatibility facade.
