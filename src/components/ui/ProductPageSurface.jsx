export function ProductPageSurface({ moduleId, pageId, children }) {
  return (
    <div
      className="product-ui-scope"
      data-product-module={moduleId || 'unknown'}
      data-product-page={pageId || 'unknown'}
    >
      {children}
    </div>
  )
}
