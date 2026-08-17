import { render, screen } from '@testing-library/react'
import { ProductPageSurface } from './ProductPageSurface'

describe('ProductPageSurface', () => {
  it('marks authenticated product content and portals with module/page scope', () => {
    const { unmount } = render(
      <ProductPageSurface moduleId="petshop" pageId="vendas">
        <div>PDV</div>
      </ProductPageSurface>,
    )

    const content = screen.getByText('PDV').parentElement
    expect(content).toHaveClass('product-ui-scope')
    expect(content).toHaveAttribute('data-product-module', 'petshop')
    expect(content).toHaveAttribute('data-product-page', 'vendas')
    expect(document.body).toHaveClass('product-ui-active')
    expect(document.body).toHaveAttribute('data-product-module', 'petshop')
    expect(document.body).toHaveAttribute('data-product-page', 'vendas')

    unmount()
    expect(document.body).not.toHaveClass('product-ui-active')
    expect(document.body).not.toHaveAttribute('data-product-module')
    expect(document.body).not.toHaveAttribute('data-product-page')
  })
})
