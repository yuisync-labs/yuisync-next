# WhatsApp coexistence fixture gate

Do not add a fabricated history payload here.

A fixture may be committed only after `docs/architecture/ADR-WHATSAPP-COEXISTENCE-HISTORY.md` is unlocked by:

1. a current official Meta source defining the coexistence/history mechanism; and
2. a real payload captured from the configured YuiSync Meta App/number.

Before commit, sanitize the capture:

- remove tokens, secrets and signatures;
- replace all WABA, business, phone-number, customer and message identifiers with deterministic fake values;
- replace real phone numbers and names;
- replace customer message text/media captions with synthetic content;
- keep only structural fields required by parser tests.

Historical fixtures must be used only by history/import tests. They must never be reused as live webhook fixtures.
