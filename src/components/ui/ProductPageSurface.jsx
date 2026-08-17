import { useEffect } from 'react'

export function ProductPageSurface({ moduleId, pageId, children }) {
  useEffect(() => {
    const body = document.body
    body.classList.add('product-ui-active')
    body.dataset.productModule = moduleId || 'unknown'
    body.dataset.productPage = pageId || 'unknown'

    return () => {
      body.classList.remove('product-ui-active')
      delete body.dataset.productModule
      delete body.dataset.productPage
    }
  }, [moduleId, pageId])

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
