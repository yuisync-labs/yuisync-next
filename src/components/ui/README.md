# YuiSync Product UI

This directory is the canonical surface layer for authenticated YuiSync products.

## Rules

1. New cards, panels, metrics and status badges must use the primitives exported by `src/components/ui`.
2. Do not create new page-local card recipes from combinations such as `bg-card + border + rounded-*`.
3. Keep semantic color meaningful: neutral by default, warning/danger/success only when the state requires it.
4. Prefer border/background changes over translate/scale/glow effects for interaction feedback.
5. Public marketing, checkout and booking surfaces are independent from this internal product system.

## Available primitives

- `Card`, `CardHeader`, `CardContent`, `CardFooter`
- `Panel`
- `MetricCard`
- `StatusBadge`
- `ProductPageSurface`

`ProductPageSurface` is the migration bridge for older authenticated screens. It applies the shared product tokens to existing surfaces and React portals while large legacy pages are incrementally converted to the primitives above.

The CI command `npm run check:product-ui` rejects new page-local raw card recipes outside this directory.
