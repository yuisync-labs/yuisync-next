import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ShoppingCart, Search, Plus, Minus, Trash2, X,
  CreditCard, Banknote, Smartphone, Check, Tag, Package,
  RefreshCw, AlertCircle, Receipt, User, History, PawPrint, MessageSquare, Truck, FileText, ExternalLink,
  ScanBarcode, MonitorUp, Keyboard, ArrowLeft
} from 'lucide-react'
import { useProducts } from '../../../shared/hooks/useProducts'
import { useSales }    from '../../../shared/hooks/useSales'
import { useClients }     from '../../../shared/hooks/useClients'
import { useAuthCtx }  from '../../../context/AuthContext'
import { usePetshopAdvanced } from '../hooks/usePetshopAdvanced'
import { fmtCurrency, todayISO } from '../../../lib/supabase'
import { normalizeDeliveryStaff, PETSHOP_DELIVERY_STAFF_TEMPLATE_KEY } from '../../../../shared/petshopOperations'
import { assignSaleDeliveryStaff } from '../lib/deliveryOperations'
import { printThermalReceipt } from '../../../lib/thermalPrint'
import { ProductCategorySelect } from '../../../components/ProductCategorySelect'
import { BASE_PRODUCT_CATEGORIES, resolveCategoryMeta } from '../../../shared/lib/productCategories'
import './VendasPage.css'

// ── Payment methods ───────────────────────────────────────────────────────────
const PAYMENT_METHODS = [
  { value:'dinheiro', label:'Dinheiro',  icon: Banknote   },
  { value:'debito',   label:'Débito',    icon: CreditCard },
  { value:'credito',  label:'Crédito',   icon: CreditCard },
  { value:'pix',      label:'Pix',       icon: Smartphone },
]

function productUnit(product) {
  const unit = product?.bot_metadata?.unit || 'UN'
  return ['UN', 'KG', 'MIL'].includes(unit) ? unit : 'UN'
}

function formatProductStock(product) {
  const unit = productUnit(product)
  const quantity = Number(product?.stock_quantity || 0)
  return `${quantity.toLocaleString('pt-BR', { maximumFractionDigits: unit === 'KG' ? 3 : 0 })} ${unit}`
}

const SALE_SOURCES = [
  { value:'pdv', label:'PDV', icon: ShoppingCart },
  { value:'whatsapp', label:'WhatsApp', icon: MessageSquare },
]

const FULFILLMENT_TYPES = [
  { value:'balcao', label:'Balcao' },
  { value:'entrega', label:'Entrega' },
  { value:'servico', label:'Servico' },
]

const createPaymentSplit = (id, method = 'dinheiro', amount = '') => ({ id, method, amount })
const DEFAULT_PAYMENT_SPLITS = [
  createPaymentSplit(1, 'dinheiro', ''),
  createPaymentSplit(2, 'credito', ''),
]
const PRODUCT_PAGE_SIZE_OPTIONS = [50, 100, 200]
const normalizeProductSearch = (value) => (value || '')
  .toString()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()
const parseCashierEntry = (value, fallbackQuantity = 1) => {
  const entry = String(value || '').trim()
  const quantityPrefix = entry.match(/^(\d+)\s*\*\s*(.*)$/)
  const quantity = Math.min(999, Math.max(1, Number(quantityPrefix?.[1] || fallbackQuantity) || 1))
  return {
    query: (quantityPrefix ? quantityPrefix[2] : entry).trim(),
    quantity,
  }
}

const CATEGORIES = [
  'Ração','Petisco','Higiene','Acessório','Medicamento','Brinquedo',
  'Importação XML','Serviço','Outro'
]

// ── Cart Item ─────────────────────────────────────────────────────────────────
function CartItem({ item, onQty, onRemove }) {
  if (!item || !item.product) return null
  const p = item.product
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 border-b border-[var(--border2)] last:border-0">
      <div className="min-w-0 flex-1 basis-[9rem]">
        <p className="text-xs font-bold text-text line-clamp-2 leading-tight mb-0.5">{p.name}</p>
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] text-muted font-medium">{fmtCurrency(p.price)} un.</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 bg-black/20 p-0.5 rounded-lg border border-[var(--border2)] self-start">
        <button onClick={() => onQty(item.product_id, -1)}
          className="w-6 h-6 rounded-md hover:bg-white/5 text-muted hover:text-text flex items-center justify-center">
          <Minus size={11}/>
        </button>
        <span className="w-5 text-center font-black text-[var(--primary)] text-[10px]">{item.quantity}</span>
        <button onClick={() => onQty(item.product_id, 1)}
          className="w-6 h-6 rounded-md hover:bg-white/5 text-muted hover:text-text flex items-center justify-center">
          <Plus size={11}/>
        </button>
      </div>
      <div className="text-right flex-shrink-0 min-w-[4.5rem] ml-auto">
        <p className="text-sm font-black text-text font-display">{fmtCurrency(p.price * item.quantity)}</p>
        <button onClick={() => onRemove(item.product_id)}
          className="text-[9px] text-red-500/40 hover:text-red-400 font-bold uppercase tracking-tighter">
          Remover
        </button>
      </div>
    </div>
  )
}

// ── Product Card ──────────────────────────────────────────────────────────────
function ProductCard({ product, onAdd, cartItem, onRemove }) {
  const stockOk = product.stock_quantity > 0
  const inCart  = !!cartItem
  const categoryMeta = resolveCategoryMeta(product.category)
  const CategoryIcon = categoryMeta.icon
  
  return (
    <div className="relative group">
      <button
        onClick={() => stockOk && onAdd(product)}
        disabled={!stockOk}
        className={`bg-card border rounded-xl p-3 text-left transition-all duration-150 relative h-full flex flex-col w-full
          ${stockOk ? 'border-[var(--border)] hover:border-[var(--primary)]/40' : 'border-[var(--border)] opacity-50'}
        `}
        style={inCart ? { 
           boxShadow: 'var(--shadow-primary)',
           borderColor: 'var(--primary)',
           backgroundColor: 'rgba(0, 240, 255, 0.05)'
        } : {}}
      >
        {inCart && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            <span className="text-gray-950 text-[11px] font-black px-2 py-0.5 rounded-full shadow-md" style={{ backgroundColor: 'var(--primary)' }}>
              {cartItem.quantity}x
            </span>
          </div>
        )}
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2.5 ${inCart ? 'text-gray-950' : ''}`}
             style={inCart ? { backgroundColor: 'var(--primary)' } : {}}>
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${inCart ? '' : categoryMeta.tileClassName}`}>
            <CategoryIcon size={16} />
          </span>
        </div>
        <p className="text-sm font-semibold text-text leading-tight truncate mb-1">{product.name}</p>
        <p className="text-xs text-muted mb-2 flex items-center gap-1.5">
          <CategoryIcon size={12} />
          {categoryMeta.label}
        </p>
        <div className="mt-auto pt-2 border-t border-[var(--border2)]/50">
          <p className="font-display font-bold text-base text-[var(--primary)]">{fmtCurrency(product.price)}</p>
          <p className="text-[10px] mt-0.5 font-medium text-muted">Estoque: {formatProductStock(product)}</p>
        </div>
      </button>

      {inCart && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(product.id, -1); }}
          className="absolute -top-1.5 -left-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg transition-all z-10 border-2 border-surface"
        >
          <Minus size={12} strokeWidth={3} />
        </button>
      )}
    </div>
  )
}

function CashierWorkspace({
  cart,
  scannerCode,
  scannerInputRef,
  scannerFeedback,
  searchResults,
  quantity,
  onScannerCodeChange,
  onQuantityChange,
  onScan,
  onChooseProduct,
  onQty,
  onRemove,
  subtotal,
  discount,
  total,
  onExit,
}) {
  const itemCount = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <div className="border-b border-[var(--border)] bg-card px-5 py-4 lg:px-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onExit} className="btn btn-secondary btn-icon" aria-label="Sair do Modo Caixa" title="Sair do Modo Caixa">
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-text">
                <MonitorUp size={18} className="text-primary" />
                Caixa em operacao
              </div>
              <p className="mt-1 text-xs text-muted">Leia o codigo de barras ou pesquise pelo nome. Atalho para voltar à busca: F2.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--primary-border)] bg-[var(--primary-bg-light)] px-3 py-1.5 text-xs font-bold text-primary">
            <span className="h-2 w-2 rounded-full bg-[var(--primary)]" />
            Scanner pronto
          </div>
        </div>

        <form onSubmit={onScan} className="grid grid-cols-[minmax(0,1fr)_120px_132px] gap-2">
          <div className="relative">
            <Search size={24} className="absolute left-4 top-1/2 -translate-y-1/2 text-primary" />
            <input
              ref={scannerInputRef}
              aria-label="Buscar produto ou ler codigo de barras"
              autoComplete="off"
              className="inp h-16 border-[var(--primary-border)] bg-white pl-14 text-xl font-bold tracking-wide shadow-sm focus:ring-2"
              placeholder="Nome, codigo ou 2*codigo"
              value={scannerCode}
              onChange={(event) => onScannerCodeChange(event.target.value)}
            />
            {parseCashierEntry(scannerCode).query.length >= 2 && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-[70] mt-2 max-h-80 overflow-y-auto rounded-2xl border border-[var(--border)] bg-card p-2 shadow-2xl">
                {searchResults.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => onChooseProduct(product)}
                    className="flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[var(--primary-bg-light)]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text">{product.name}</div>
                      <div className="mt-0.5 text-xs text-muted">EAN {product.barcode || 'nao cadastrado'} · Estoque {product.stock_quantity}</div>
                    </div>
                    <strong className="flex-shrink-0 text-sm text-primary">{fmtCurrency(product.price)}</strong>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="flex h-16 flex-col justify-center rounded-xl border border-[var(--border)] bg-white px-3 shadow-sm">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Quantidade</span>
            <input
              aria-label="Quantidade do produto"
              type="number"
              min="1"
              max="999"
              value={quantity}
              onChange={(event) => onQuantityChange(event.target.value)}
              className="w-full bg-transparent text-xl font-bold text-text outline-none"
            />
          </label>
          <button type="submit" className="btn btn-primary h-16 justify-center px-5">
            Adicionar
          </button>
        </form>
        {scannerFeedback && (
          <div
            role="status"
            className={`mt-2 text-xs font-semibold ${scannerFeedback.type === 'error' ? 'text-red-500' : 'text-primary'}`}
          >
            {scannerFeedback.message}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 lg:px-7">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-text">Itens da venda</h2>
            <p className="text-xs text-muted">{itemCount} {itemCount === 1 ? 'item registrado' : 'itens registrados'}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Keyboard size={15} /> Leitura continua ativa
          </div>
        </div>

        {cart.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-card p-8 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--primary-bg-light)] text-primary">
              <ScanBarcode size={32} />
            </div>
            <h3 className="font-bold text-text">Aguardando o primeiro produto</h3>
            <p className="mt-1 max-w-sm text-sm text-muted">Leia o código de barras ou pesquise pelo nome para adicionar um produto.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card shadow-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_110px_150px_120px_48px] gap-3 border-b border-[var(--border)] bg-slate-50 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted">
              <span>Produto</span><span>Unitario</span><span>Quantidade</span><span className="text-right">Subtotal</span><span />
            </div>
            {cart.map((item) => (
              <div key={item.product_id} className="grid grid-cols-[minmax(0,1fr)_110px_150px_120px_48px] items-center gap-3 border-b border-[var(--border2)] px-5 py-4 last:border-0">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-text">{item.product?.name || item.name}</div>
                  <div className="mt-0.5 text-xs text-muted">EAN {item.product?.barcode || 'nao cadastrado'}</div>
                </div>
                <div className="text-sm text-muted">{fmtCurrency(item.unit_price)}</div>
                <div className="inline-flex w-fit items-center rounded-xl border border-[var(--border)] bg-slate-50 p-1">
                  <button type="button" aria-label={`Diminuir ${item.product?.name || item.name}`} onClick={() => onQty(item.product_id, -1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-text"><Minus size={14} /></button>
                  <span className="w-10 text-center text-sm font-bold text-text">{item.quantity}</span>
                  <button type="button" aria-label={`Aumentar ${item.product?.name || item.name}`} onClick={() => onQty(item.product_id, 1)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white hover:text-text"><Plus size={14} /></button>
                </div>
                <div className="text-right text-base font-bold text-text">{fmtCurrency(item.unit_price * item.quantity)}</div>
                <button type="button" aria-label={`Remover ${item.product?.name || item.name}`} onClick={() => onRemove(item.product_id)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-500"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--border)] bg-card px-5 py-4 lg:px-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex gap-8 text-sm">
            <div><span className="block text-xs text-muted">Subtotal</span><strong className="text-text">{fmtCurrency(subtotal)}</strong></div>
            <div><span className="block text-xs text-muted">Desconto</span><strong className="text-text">{fmtCurrency(Number(discount) || 0)}</strong></div>
          </div>
          <div className="text-right">
            <span className="block text-xs font-bold uppercase tracking-widest text-muted">Total da compra</span>
            <strong className="font-display text-4xl font-bold text-primary">{fmtCurrency(total)}</strong>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Success Modal (Recibo Dinâmico) ───────────────────────────────────────────
function SuccessModal({ sale, onClose, onIssueFiscal, issuingFiscal }) {
  const { storeSettings } = useAuthCtx()
  const fiscal = sale?.fiscal || null
  const isFiscalAuthorized = fiscal?.document?.status === 'authorized' || fiscal?.invoice?.fiscal_status === 'authorized'
  const fiscalKey = fiscal?.document?.nfe_key || fiscal?.invoice?.invoice_nfe_url || ''
  const fiscalPdfUrl = fiscal?.document?.pdf_url || ''
  const canConsultFiscal = Boolean(fiscalKey)
  const receiptLabel = sale?.source === 'whatsapp' && sale?.fulfillmentType === 'entrega'
    ? 'Comprovante ENTREGA'
    : 'Comprovante TERMICO'

  const fiscalStatusLabel = (() => {
    if (!fiscal) return 'Cupom fiscal ainda nao emitido.'
    if (fiscal.status === 'runtime_missing') return 'Runtime fiscal nao habilitado no banco.'
    if (fiscal.document?.status === 'authorized') return 'Cupom fiscal emitido e autorizado.'
    if (fiscal.document?.status === 'pending' || fiscal.invoice?.fiscal_status === 'pending') return 'Documento fiscal em processamento.'
    if (fiscal.document?.status === 'failed' || fiscal.document?.status === 'rejected') return fiscal.document?.error_message || 'Documento fiscal com falha.'
    if (fiscal.invoice?.fiscal_status === 'not_requested') return 'Emissao fiscal desativada para este tenant.'
    return 'Documento fiscal aguardando configuracao.'
  })()

  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    const date = new Date().toLocaleString('pt-BR')
    const addr = [
      storeSettings?.store_address,
      storeSettings?.store_neighborhood,
      storeSettings?.store_city
    ].filter(Boolean).join(' - ')

    const receiptHtml = `
      <html>
        <head>
          <style>
            @page { margin: 0; }
            * { box-sizing: border-box; }
            html, body { width: 80mm; height: auto !important; min-height: 0 !important; margin: 0; padding: 0; overflow: visible; }
            body { font-family: 'Courier New', Courier, monospace; padding: 6px; color: #000; }
            .receipt { width: 100%; height: auto; min-height: 0; break-after: avoid-page; page-break-after: avoid; }
            @media print { html, body { height: auto !important; min-height: 0 !important; } body, .receipt { position: absolute !important; top: 0 !important; left: 0 !important; } }
            .center { text-align: center; }
            .hr { border-bottom: 1px dashed #000; margin: 10px 0; }
            .header { font-weight: bold; font-size: 1.1em; margin-bottom: 5px; text-transform: uppercase; }
            .info { font-size: 0.85em; margin-bottom: 3px; }
            .item { display: flex; justify-content: space-between; font-size: 0.9em; margin: 3px 0; }
            .total-row { display: flex; justify-content: space-between; font-weight: bold; margin-top: 5px; }
            .footer { font-size: 0.8em; margin-top: 15px; color: #333; }
          </style>
        </head>
        <body><main class="receipt">
          <div class="center">
            <div class="header">${storeSettings?.store_name?.toUpperCase() || 'PETSHOP CRM'}</div>
            <div class="info">${addr || 'Endereço não configurado'}</div>
            <div class="info">Tel: ${storeSettings?.store_phone || '(00) 00000-0000'}</div>
          </div>
          <div class="hr"></div>
          <div class="item"><strong>ITEM</strong> <strong>QTD x VL</strong></div>
          ${sale.cart.map(i => `
            <div class="item">
              <span>${(i.product?.name || i.name || 'Produto').substring(0, 18)}</span>
              <span>${i.quantity}x ${Number(i.unit_price || 0).toFixed(2)}</span>
            </div>
          `).join('')}
          <div class="hr"></div>
          <div class="total-row"><span>SUBTOTAL:</span> <span>R$ ${(sale.total + (sale.discount || 0) - (sale.deliveryFee || 0)).toFixed(2)}</span></div>
          ${sale.discount > 0 ? `<div class="total-row" style="color:red"><span>DESCONTO:</span> <span>-R$ ${sale.discount.toFixed(2)}</span></div>` : ''}
          ${sale.deliveryFee > 0 ? `<div class="total-row"><span>ENTREGA:</span> <span>R$ ${sale.deliveryFee.toFixed(2)}</span></div>` : ''}
          <div class="total-row" style="font-size: 1.2em;"><span>TOTAL:</span> <span>R$ ${sale.total.toFixed(2)}</span></div>
          <div class="hr"></div>
          <div class="info center">Pagamento: ${sale.payment.toUpperCase()}</div>
          <div class="info center">Cliente: ${sale.customer || 'Balcão'}</div>
          <div class="info center">Data: ${date}</div>
          <div class="footer center">Obrigado pela preferência!</div>
        </main></body>
      </html>
    `
    printWindow.document.write(receiptHtml)
    printWindow.document.close()
    printThermalReceipt(printWindow)
  }

  const handleOpenFiscalConsult = () => {
    if (!canConsultFiscal) return
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(fiscalKey).catch(() => {})
    }
    window.open('https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ+gAVw2g=', '_blank')
  }

  const handlePrintFiscal = () => {
    if (!fiscal) return
    if (fiscalPdfUrl) {
      window.open(fiscalPdfUrl, '_blank')
      return
    }

    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    const date = new Date().toLocaleString('pt-BR')

    const html = `
      <html>
        <head>
          <style>
            @page { margin: 0; }
            * { box-sizing: border-box; }
            html, body { width: 80mm; height: auto !important; min-height: 0 !important; margin: 0; padding: 0; overflow: visible; }
            body { font-family: 'Courier New', Courier, monospace; padding: 6px; color: #000; }
            .receipt { width: 100%; height: auto; min-height: 0; break-after: avoid-page; page-break-after: avoid; }
            @media print { html, body { height: auto !important; min-height: 0 !important; } body, .receipt { position: absolute !important; top: 0 !important; left: 0 !important; } }
            .center { text-align: center; }
            .hr { border-bottom: 1px dashed #000; margin: 10px 0; }
            .line { display: flex; justify-content: space-between; font-size: 0.9em; margin: 3px 0; }
            .header { font-weight: bold; text-transform: uppercase; }
            .small { font-size: 0.8em; }
            .key { font-size: 0.75em; word-break: break-all; }
          </style>
        </head>
        <body><main class="receipt">
          <div class="center header">${storeSettings?.store_name?.toUpperCase() || 'PETSHOP CRM'}</div>
          <div class="hr"></div>
          <div class="line"><strong>DOCUMENTO</strong><strong>${String(fiscal?.document?.document_type || 'nfce').toUpperCase()}</strong></div>
          <div class="line"><span>STATUS</span><span>${fiscalStatusLabel}</span></div>
          <div class="line"><span>VENDA</span><span>#${String(sale.id || '').slice(0, 8).toUpperCase()}</span></div>
          <div class="line"><span>VALOR</span><span>${fmtCurrency(sale.total || 0)}</span></div>
          ${fiscalKey ? `<div class="hr"></div><div class="small">CHAVE FISCAL</div><div class="key">${fiscalKey}</div>` : ''}
          ${fiscal?.document?.protocol_number ? `<div class="line"><span>PROTOCOLO</span><span>${fiscal.document.protocol_number}</span></div>` : ''}
          <div class="hr"></div>
          <div class="small center">Emitido em ${date}</div>
        </main></body>
      </html>
    `

    printWindow.document.write(html)
    printWindow.document.close()
    printThermalReceipt(printWindow)
  }

  return createPortal(
    <div className="modal-overlay theme-petshop-modal" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box max-w-sm">
        <div className="modal-header">
           <h2 className="font-display font-bold text-xl text-text">Venda Registrada!</h2>
           <button onClick={onClose} className="text-muted hover:text-text ml-1"><X size={18}/></button>
        </div>

        <div className="modal-body text-center">
          <div className="w-16 h-16 rounded-3xl bg-[var(--primary-bg-light)] flex items-center justify-center text-primary mx-auto mb-6 border border-[var(--primary-border)] shadow-inner">
             <Check size={32} strokeWidth={3}/>
          </div>
          
          <div className="space-y-1 mb-8">
            <p className="text-muted text-[10px] uppercase font-black tracking-[0.2em]">Total da Venda</p>
            <div className="font-display font-bold text-4xl text-primary">
              {fmtCurrency(sale.total)}
            </div>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-2xl p-5 text-left space-y-3 mb-8">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted font-bold uppercase tracking-wider">Pagamento</span>
              <span className="text-text font-black uppercase">{sale.payment}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted font-bold uppercase tracking-wider">Cliente</span>
              <span className="text-text font-black">{sale.customer || 'Balcão'}</span>
            </div>
            <div className="flex justify-between items-center text-xs pt-2 border-t border-white/5">
              <span className="text-muted font-bold uppercase tracking-wider">Itens Vendidos</span>
              <span className="text-text font-black">{sale.cart.length} unid.</span>
            </div>
            <div className="pt-2 border-t border-white/5">
              <p className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Fiscal</p>
              <p className="text-xs text-text">{fiscalStatusLabel}</p>
              {fiscal?.document?.nfe_key && (
                <p className="text-[10px] text-emerald-400 mt-1 break-all">
                  Chave: {fiscal.document.nfe_key}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button onClick={handlePrint} className="btn btn-secondary w-full justify-center gap-2 border-white/10 text-primary py-3">
              <Receipt size={16}/> {receiptLabel}
            </button>
            <button
              onClick={handleOpenFiscalConsult}
              disabled={!canConsultFiscal}
              className="btn btn-secondary w-full justify-center gap-2 border-white/10 py-3 disabled:opacity-60"
            >
              <ExternalLink size={16} />
              Consulta Fiscal
            </button>
            <button
              onClick={onIssueFiscal}
              disabled={issuingFiscal || isFiscalAuthorized}
              className="btn btn-secondary w-full justify-center gap-2 border-white/10 py-3 disabled:opacity-60"
            >
              {issuingFiscal ? <RefreshCw size={16} className="animate-spin" /> : <FileText size={16} />}
              {isFiscalAuthorized ? 'Cupom Fiscal Emitido' : 'Emitir Cupom Fiscal'}
            </button>
            <button
              onClick={handlePrintFiscal}
              disabled={!fiscal}
              className="btn btn-secondary w-full justify-center gap-2 border-white/10 py-3 disabled:opacity-60"
            >
              <Receipt size={16} />
              Imprimir Cupom Fiscal
            </button>
            <button onClick={onClose} className="btn btn-primary w-full justify-center py-3 shadow-lg font-black text-xs uppercase tracking-widest">
              Próximo Cliente
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Página Principal ──────────────────────────────────────────────────────────
export default function VendasPage() {
  const { products, loading: prodLoading, load: loadProducts, error: prodError } = useProducts()
  const {
    sales,
    loading: salesLoading,
    error: salesError,
    load: loadSales,
    createSale,
    issueSaleFiscal,
    getDailyStats,
  } = useSales()
  const { clients: pets, load: loadPets }                                = useClients()
  const { loadSalesStaff } = usePetshopAdvanced()
  const auth = useAuthCtx()

  const [cart, setCart]         = useState(() => {
    const saved = localStorage.getItem('petshop_cart')
    return saved ? JSON.parse(saved) : []
  })
  const [search, setSearch]     = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [productPageSize, setProductPageSize] = useState(PRODUCT_PAGE_SIZE_OPTIONS[0])
  const [productPage, setProductPage] = useState(1)
  const [payment, setPayment]   = useState('dinheiro')
  const [discount, setDiscount] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [petId, setPetId]       = useState('')
  const [saleSource, setSaleSource] = useState('pdv')
  const [fulfillmentType, setFulfillmentType] = useState('balcao')
  const [deliveryStaffKey, setDeliveryStaffKey] = useState('')
  const [paymentBreakdownEnabled, setPaymentBreakdownEnabled] = useState(false)
  const [paymentBreakdown, setPaymentBreakdown] = useState(DEFAULT_PAYMENT_SPLITS)
  const [sellers, setSellers] = useState([])
  const [sellerId, setSellerId] = useState(auth?.profile?.id || '')
  const [saving, setSaving]     = useState(false)
  const deliveryStaff = useMemo(() => normalizeDeliveryStaff(auth?.storeSettings?.petshop_delivery_staff || auth?.storeSettings?.message_templates?.[PETSHOP_DELIVERY_STAFF_TEMPLATE_KEY]).filter((person) => person.active !== false), [auth?.storeSettings])
  const checkoutAttemptRef = useRef({ fingerprint: '', key: '' })
  const [err, setErr]           = useState('')
  const [successSale, setSuccessSale] = useState(null)
  const [issuingFiscalSaleId, setIssuingFiscalSaleId] = useState('')
  const [dailyStats, setDailyStats]     = useState({ revenue: 0, count: 0, upsells: 0 })
  const [tab, setTab]           = useState('pdv')
  const [historyDate, setHistoryDate] = useState(todayISO())
  const [upsellCandidate, setUpsellCandidate] = useState(null)
  const [scannerCode, setScannerCode] = useState('')
  const [scannerQuantity, setScannerQuantity] = useState(1)
  const [scannerFeedback, setScannerFeedback] = useState(null)
  const scannerInputRef = useRef(null)

  useEffect(() => {
    const enabled = tab === 'caixa'
    window.dispatchEvent(new CustomEvent('yuisync:focus-mode', { detail: enabled }))
    return () => {
      if (enabled) window.dispatchEvent(new CustomEvent('yuisync:focus-mode', { detail: false }))
    }
  }, [tab])

  useEffect(() => {
    loadProducts({ activeOnly: true })
    loadPets()
    loadSales({ date: todayISO() })
    getDailyStats().then(setDailyStats)
    loadSalesStaff().then((items) => {
      setSellers(items || [])
      if (!sellerId && auth?.profile?.id) setSellerId(auth.profile.id)
    }).catch((err) => console.warn('Falha ao carregar vendedores:', err))
  }, [loadProducts, loadPets, loadSales, getDailyStats])

  useEffect(() => {
    if (tab === 'historico') {
      loadSales({ date: historyDate })
    }
  }, [tab, historyDate, loadSales])

  useEffect(() => {
    localStorage.setItem('petshop_cart', JSON.stringify(cart))
  }, [cart])

  const [customerSearch, setCustomerSearch] = useState('')
  const [showResults, setShowResults] = useState(false)
  const searchRef = useRef(null)
  const selectedPet = useMemo(
    () => (pets || []).find((pet) => String(pet.id) === String(petId)) || null,
    [pets, petId],
  )

  const filteredPets = useMemo(() => (pets || []).filter(p => {
    const raw = (v) => (v || '').toString().replace(/\D/g, '')
    const normalize = (val) => (val || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    const query = normalize(customerSearch)
    const queryDigits = raw(customerSearch)
    
    if (!customerSearch) return false

    const textFields = [p.owner_name, p.pet_name, p.breed, p.owner_address, p.owner_neighborhood, p.owner_city]
    const digitFields = [p.phone, p.owner_cpf]

    const matchText = textFields.some(f => normalize(f).includes(query))
    const matchDigit = queryDigits && digitFields.some(f => raw(f).includes(queryDigits))

    return matchText || matchDigit
  }), [pets, customerSearch])

  useEffect(() => {
    const handleClick = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowResults(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = useMemo(() => (products || []).filter(p => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    const matchesCat = !catFilter || p.category === catFilter
    return matchesSearch && matchesCat
  }), [products, search, catFilter])

  const cashierProductResults = useMemo(() => {
    const rawQuery = parseCashierEntry(scannerCode, scannerQuantity).query
    const query = normalizeProductSearch(rawQuery)
    if (tab !== 'caixa' || query.length < 2) return []

    return (products || [])
      .filter((product) => {
        if (Number(product.stock_quantity || 0) <= 0) return false
        const barcode = String(product.barcode || '').trim()
        return normalizeProductSearch(product.name).includes(query) || (barcode && barcode.includes(rawQuery))
      })
      .slice(0, 8)
  }, [products, scannerCode, scannerQuantity, tab])
  
  const cartProductIds = useMemo(() => new Set(cart.map((item) => item.product_id)), [cart])
  const cartByProductId = useMemo(() => new Map(cart.map((item) => [item.product_id, item])), [cart])
  const selectedProducts = useMemo(() => filtered.filter(p => cartProductIds.has(p.id)), [filtered, cartProductIds])
  const otherProducts = useMemo(() => filtered.filter(p => !cartProductIds.has(p.id)), [filtered, cartProductIds])
  const productTotalPages = Math.max(1, Math.ceil(otherProducts.length / productPageSize))
  const currentProductPage = Math.min(productPage, productTotalPages)
  const productPageStart = otherProducts.length ? (currentProductPage - 1) * productPageSize : 0
  const productPageEnd = Math.min(productPageStart + productPageSize, otherProducts.length)
  const visibleOtherProducts = useMemo(
    () => otherProducts.slice(productPageStart, productPageEnd),
    [otherProducts, productPageStart, productPageEnd]
  )

  useEffect(() => {
    setProductPage(1)
  }, [search, catFilter, productPageSize])

  useEffect(() => {
    setProductPage((page) => Math.min(page, productTotalPages))
  }, [productTotalPages])

  const subtotal = cart.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const deliveryFee = fulfillmentType === 'entrega'
    ? Math.max(0, Number(auth?.storeSettings?.delivery_fee ?? 8))
    : 0
  const total = Math.max(0, subtotal - (Number(discount) || 0)) + deliveryFee
  const breakdownTotal = paymentBreakdown.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const breakdownRemaining = Math.max(0, total - breakdownTotal)

  const addToCart = (product, quantity = 1) => {
    setCart(prev => {
      const exists = prev.find(i => i.product_id === product.id)
      if (exists) return prev.map(i => i.product_id === product.id ? { ...i, quantity: i.quantity + quantity } : i)
      return [...prev, { product_id: product.id, product, name: product.name, unit_price: product.price, quantity }]
    })
    
    // Verificamos se há um Upsell vinculado
    if (product.upsell_link_id) {
       const upsell = products.find(p => p.id === product.upsell_link_id)
       if (upsell && !cart.some(i => i.product_id === upsell.id)) {
          setUpsellCandidate(upsell)
       }
    }

    setSearch('')
  }

  const handleScannerSubmit = (event) => {
    event.preventDefault()
    const entry = parseCashierEntry(scannerCode, scannerQuantity)
    const code = entry.query
    const quantity = entry.quantity
    if (!code) {
      setScannerFeedback({ type: 'error', message: 'Leia ou digite um codigo de barras.' })
      scannerInputRef.current?.focus()
      return
    }

    let product = products.find((item) => String(item.barcode || '').trim() === code)
    if (!product && cashierProductResults.length === 1) {
      product = cashierProductResults[0]
    }
    if (!product) {
      setScannerFeedback({
        type: cashierProductResults.length > 1 ? 'success' : 'error',
        message: cashierProductResults.length > 1
          ? 'Selecione um dos produtos encontrados abaixo.'
          : `Nenhum produto encontrado para "${code}".`,
      })
      scannerInputRef.current?.focus()
      return
    }
    if (Number(product.stock_quantity || 0) <= 0) {
      setScannerFeedback({ type: 'error', message: `${product.name} esta sem estoque.` })
      setScannerCode('')
      scannerInputRef.current?.focus()
      return
    }
    const quantityInCart = Number(cart.find((item) => item.product_id === product.id)?.quantity || 0)
    if (quantityInCart + quantity > Number(product.stock_quantity || 0)) {
      setScannerFeedback({ type: 'error', message: `Estoque insuficiente. Disponivel: ${product.stock_quantity}.` })
      scannerInputRef.current?.focus()
      return
    }

    addToCart(product, quantity)
    setScannerFeedback({ type: 'success', message: `${quantity}x ${product.name} adicionado ao carrinho.` })
    setScannerCode('')
    setScannerQuantity(1)
    requestAnimationFrame(() => scannerInputRef.current?.focus())
  }

  const handleChooseCashierProduct = (product) => {
    const quantity = parseCashierEntry(scannerCode, scannerQuantity).quantity
    const quantityInCart = Number(cart.find((item) => item.product_id === product.id)?.quantity || 0)
    if (quantityInCart + quantity > Number(product.stock_quantity || 0)) {
      setScannerFeedback({ type: 'error', message: `Estoque insuficiente. Disponivel: ${product.stock_quantity}.` })
      return
    }
    addToCart(product, quantity)
    setScannerFeedback({ type: 'success', message: `${quantity}x ${product.name} adicionado ao carrinho.` })
    setScannerCode('')
    setScannerQuantity(1)
    requestAnimationFrame(() => scannerInputRef.current?.focus())
  }

  useEffect(() => {
    if (tab !== 'caixa') return undefined
    scannerInputRef.current?.focus()

    const focusScanner = (event) => {
      if (event.key !== 'F2') return
      event.preventDefault()
      scannerInputRef.current?.focus()
      scannerInputRef.current?.select()
    }
    window.addEventListener('keydown', focusScanner)
    return () => window.removeEventListener('keydown', focusScanner)
  }, [tab])

  const changeQty = (productId, delta) => {
    setCart(prev => prev.map(i => i.product_id === productId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i).filter(i => i.quantity > 0))
  }

  const removeFromCart = (productId) => setCart(prev => prev.filter(i => i.product_id !== productId))

  const paymentLabel = (value) => PAYMENT_METHODS.find((method) => method.value === value)?.label || value

  const updatePaymentSplit = (id, key, value) => {
    setPaymentBreakdown((prev) => prev.map((item) => item.id === id ? { ...item, [key]: value } : item))
  }

  const addPaymentSplit = () => {
    setPaymentBreakdown((prev) => {
      if (prev.length >= 4) return prev
      const nextId = Math.max(...prev.map((item) => item.id), 0) + 1
      return [...prev, createPaymentSplit(nextId, 'pix', '')]
    })
  }

  const removePaymentSplit = (id) => {
    setPaymentBreakdown((prev) => prev.length <= 2 ? prev : prev.filter((item) => item.id !== id))
  }

  const buildPaymentDescriptor = () => {
    if (!paymentBreakdownEnabled) return payment
    return `multiplo (${paymentBreakdown.map((item) => `${paymentLabel(item.method)} ${fmtCurrency(item.amount || 0)}`).join(' + ')})`
  }

  const clearCart = () => {
    setCart([]); setDiscount(0); setCustomerName(''); setPetId(''); setPayment('dinheiro'); setSaleSource('pdv'); setFulfillmentType('balcao'); setPaymentBreakdownEnabled(false); setPaymentBreakdown(DEFAULT_PAYMENT_SPLITS)
    localStorage.removeItem('petshop_cart')
  }

  const reloadHistoryScope = async () => {
    if (tab === 'historico') {
      await loadSales({ date: historyDate })
    } else {
      await loadSales({ date: todayISO() })
    }
  }

  const buildSuccessSalePayload = (saleRow, fiscal = null) => ({
    id: saleRow?.id,
    cart: (saleRow?.sale_items || []).map((item) => ({
      product: item?.products || null,
      name: item?.products?.name || 'Item',
      quantity: Number(item?.quantity || 1),
      unit_price: Number(item?.unit_price || 0),
    })),
    customer: saleRow?.customer_name || 'Balcao',
    payment: saleRow?.payment_method || 'dinheiro',
    discount: Number(saleRow?.discount || 0),
    total: Number(saleRow?.total_price || 0),
    deliveryFee: Number(saleRow?.delivery_fee || 0),
    fiscal,
    source: saleRow?.source || 'pdv',
    fulfillmentType: saleRow?.fulfillment_type || 'balcao',
  })

  const handleIssueFiscal = async (saleId, options = {}) => {
    const {
      updateSuccessModal = false,
      openSuccessModal = false,
      saleSnapshot = null,
      silentError = false,
    } = options
    if (!saleId) return
    setIssuingFiscalSaleId(saleId)
    setErr('')
    try {
      const fiscalResult = await issueSaleFiscal(saleId)
      if (updateSuccessModal || openSuccessModal) {
        setSuccessSale((prev) => {
          if (prev && prev.id === saleId) {
            return { ...prev, fiscal: fiscalResult || null }
          }
          if (openSuccessModal && saleSnapshot) {
            return buildSuccessSalePayload(saleSnapshot, fiscalResult || null)
          }
          return prev
        })
      }
      await reloadHistoryScope()
    } catch (issueError) {
      if (silentError) {
        console.warn('Falha na emissao fiscal automatica:', issueError)
      } else {
        setErr(issueError?.message || 'Falha ao emitir cupom fiscal.')
      }
    } finally {
      setIssuingFiscalSaleId('')
    }
  }

  const handleSell = async () => {
    if (!cart.length) return setErr('Carrinho vazio')
    if (saleSource === 'whatsapp' && fulfillmentType !== 'balcao' && !petId) {
      return setErr('Selecione o cliente/pet para gerar a ordem com endereco e historico de chat.')
    }
    if (paymentBreakdownEnabled) {
      const activeSplits = paymentBreakdown.filter((item) => Number(item.amount || 0) > 0)
      if (activeSplits.length < 2) {
        return setErr('Informe pelo menos duas formas de pagamento com valor.')
      }
      if (Math.abs(breakdownTotal - total) > 0.009) {
        return setErr(`Os pagamentos precisam fechar exatamente ${fmtCurrency(total)}.`)
      }
    }
    setSaving(true); setErr('')
    try {
      const checkoutFingerprint = JSON.stringify({
        cart: cart.map((item) => [item.product_id, item.quantity, item.upsell === true]),
        petId,
        payment,
        paymentBreakdownEnabled,
        paymentBreakdown,
        discount: Number(discount) || 0,
        saleSource,
        fulfillmentType,
      })
      if (checkoutAttemptRef.current.fingerprint !== checkoutFingerprint) {
        checkoutAttemptRef.current = { fingerprint: checkoutFingerprint, key: crypto.randomUUID() }
      }
      const paymentDescriptor = buildPaymentDescriptor()
      const paymentSplits = paymentBreakdownEnabled
        ? paymentBreakdown
          .filter((item) => Number(item.amount || 0) > 0)
          .map((item) => ({ method: item.method, amount: Number(item.amount || 0) }))
        : []
      const splitNotes = paymentBreakdownEnabled
        ? `Pagamento dividido: ${paymentBreakdown.filter((item) => Number(item.amount || 0) > 0).map((item) => `${paymentLabel(item.method)} ${fmtCurrency(item.amount || 0)}`).join(' + ')}`
        : null

      const createdSale = await createSale({
        customer_name:   customerName || 'Balcão',
        client_id:       selectedPet?.tutor_group_id || null,
        pet_id:          petId || null,
        payment_method:  paymentBreakdownEnabled ? 'multiplo' : payment,
        discount:        Number(discount) || 0,
        employee_id:     sellerId || auth?.profile?.id,
        source:          saleSource,
        fulfillment_type: saleSource === 'whatsapp' ? fulfillmentType : 'balcao',
        payment_splits:  paymentSplits,
        notes:           splitNotes,
        idempotency_key: checkoutAttemptRef.current.key,
      }, cart)
      
      if (fulfillmentType === 'entrega' && deliveryStaffKey) {
        const selectedDeliveryStaff = deliveryStaff.find((person) => person.key === deliveryStaffKey)
        if (selectedDeliveryStaff) await assignSaleDeliveryStaff({ moduleId: 'petshop', tenantId: auth?.activeTenantId, saleId: createdSale.id, staff: selectedDeliveryStaff, deliveryValue: deliveryFee })
      }
      setSuccessSale({
        id: createdSale?.id,
        cart: [...cart],
        customer: customerName || 'Balcão',
        payment: paymentDescriptor,
        discount: Number(discount) || 0,
        total: Number(createdSale?.total_price ?? total),
        deliveryFee: Number(createdSale?.delivery_fee ?? deliveryFee),
        fiscal: null,
        source: createdSale?.source || saleSource,
        fulfillmentType: createdSale?.fulfillment_type || (saleSource === 'whatsapp' ? fulfillmentType : 'balcao'),
      })
      clearCart()
      setDeliveryStaffKey('')
      checkoutAttemptRef.current = { fingerprint: '', key: '' }
      await reloadHistoryScope()
      getDailyStats().then(setDailyStats)
      void handleIssueFiscal(createdSale?.id, { updateSuccessModal: true, silentError: true })
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="animate-fade-up h-full min-h-0 flex flex-col yuisync-pos-shell">
      {tab !== 'caixa' && (
      <div className="px-6 lg:px-8 pt-6 pb-4 flex-shrink-0 yuisync-pos-header">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <ShoppingCart size={22} style={{ color: 'var(--primary)' }}/> Vendas / PDV
            </h1>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-right yuisync-pos-day-summary">
            <div>
              <p className="text-xs text-muted">Hoje</p>
              <p className="font-display font-bold text-xl text-emerald-400">{fmtCurrency(dailyStats.revenue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Vendas</p>
              <p className="font-display font-bold text-xl text-text">{dailyStats.count}</p>
            </div>
          </div>
        </div>

        <div className="flex bg-white/5 border border-white/5 rounded-xl p-1 w-fit yuisync-pos-tabs">
          <button onClick={() => setTab('pdv')}
            className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition-all ${
              tab === 'pdv' ? 'bg-primary text-gray-950 shadow-lg' : 'text-muted hover:text-text'
            }`}
            style={tab === 'pdv' ? { backgroundColor: 'var(--primary)' } : {}}
          >
            <ShoppingCart size={14}/> PDV
          </button>
          <button onClick={() => setTab('caixa')}
            className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition-all ${
              tab === 'caixa' ? 'bg-primary text-gray-950 shadow-lg' : 'text-muted hover:text-text'
            }`}
            style={tab === 'caixa' ? { backgroundColor: 'var(--primary)' } : {}}
          >
            <ScanBarcode size={14}/> Modo Caixa
          </button>
          <button onClick={() => setTab('historico')}
            className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition-all ${
              tab === 'historico' ? 'bg-primary text-gray-950 shadow-lg' : 'text-muted hover:text-text'
            }`}
            style={tab === 'historico' ? { backgroundColor: 'var(--primary)' } : {}}
          >
            <History size={14}/> Histórico
          </button>
        </div>
      </div>
      )}

      {tab === 'historico' ? (
        <div className="flex-1 overflow-y-auto px-6 lg:px-8 pb-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted">Historico do dia</p>
            <input
              aria-label="Data do historico de vendas"
              type="date"
              className="inp py-2 text-xs w-auto"
              value={historyDate}
              onChange={(event) => setHistoryDate(event.target.value || todayISO())}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setHistoryDate(todayISO())}
            >
              Hoje
            </button>
          </div>
          <div className="tbl-wrapper">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Horário</th>
                  <th>Cliente</th>
                  <th>Descrição</th>
                  <th>Total</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {salesLoading ? (
                  <tr>
                    <td colSpan={5} className="text-center text-sm text-muted py-8">
                      Carregando vendas...
                    </td>
                  </tr>
                ) : salesError ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8">
                      <p className="text-sm text-red-400">Nao foi possivel carregar o historico: {salesError}</p>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm mt-3"
                        onClick={() => loadSales({ date: historyDate })}
                      >
                        <RefreshCw size={12} /> Tentar novamente
                      </button>
                    </td>
                  </tr>
                ) : sales.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-sm text-muted py-8">
                      Nenhuma venda encontrada para {new Date(`${historyDate}T00:00:00`).toLocaleDateString('pt-BR')}.
                    </td>
                  </tr>
                ) : sales.map(s => (
                  <tr key={s.id}>
                    <td className="font-bold text-[var(--primary)]">{new Date(s.created_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}</td>
                    <td>{s.customer_name || 'Balcão'}</td>
                    <td className="max-w-[200px]">
                      <p className="text-xs text-muted truncate" title={s.sale_items?.map(i => `${i.quantity}x ${i.products?.name}`).join(', ')}>
                        {s.sale_items?.map(i => i.products?.name).join(', ') || 'Sem itens'}
                      </p>
                    </td>
                    <td className="font-bold text-emerald-400">{fmtCurrency(s.total_price)}</td>
                    <td className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => setSuccessSale(buildSuccessSalePayload(s))}
                          className="btn btn-secondary btn-sm btn-icon"
                          title="Ver comprovante"
                        >
                          <Receipt size={14}/>
                        </button>
                        <button
                          onClick={() => handleIssueFiscal(s.id)}
                          disabled={issuingFiscalSaleId === s.id}
                          className="btn btn-secondary btn-sm gap-1.5"
                          title="Emitir cupom fiscal"
                        >
                          {issuingFiscalSaleId === s.id ? <RefreshCw size={12} className="animate-spin" /> : <FileText size={12} />}
                          Cupom
                        </button>
                        <button
                          onClick={() => handleIssueFiscal(s.id, { openSuccessModal: true, saleSnapshot: s })}
                          disabled={issuingFiscalSaleId === s.id}
                          className="btn btn-secondary btn-sm gap-1.5"
                          title="Consultar fiscal"
                        >
                          {issuingFiscalSaleId === s.id ? <RefreshCw size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                          Consulta
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden min-h-0 yuisync-pos-workspace">
          <div className="flex-1 flex flex-col overflow-hidden border-r border-[var(--border2)] yuisync-pos-catalog">
            {tab === 'caixa' ? (
              <CashierWorkspace
                cart={cart}
                scannerCode={scannerCode}
                scannerInputRef={scannerInputRef}
                scannerFeedback={scannerFeedback}
                searchResults={cashierProductResults}
                quantity={scannerQuantity}
                onScannerCodeChange={(value) => {
                  setScannerCode(value)
                  const quantityPrefix = value.match(/^(\d+)\s*\*/)
                  if (quantityPrefix) {
                    setScannerQuantity(Math.min(999, Math.max(1, Number(quantityPrefix[1]) || 1)))
                  }
                  if (scannerFeedback) setScannerFeedback(null)
                }}
                onQuantityChange={(value) => setScannerQuantity(Math.min(999, Math.max(1, Number(value) || 1)))}
                onScan={handleScannerSubmit}
                onChooseProduct={handleChooseCashierProduct}
                onQty={changeQty}
                onRemove={removeFromCart}
                subtotal={subtotal}
                discount={discount}
                total={total}
                onExit={() => setTab('pdv')}
              />
            ) : (
              <>
            <div className="px-4 py-3 border-b border-[var(--border2)] flex items-center gap-4 yuisync-pos-toolbar">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"/>
                <input aria-label="Buscar produto" className="inp pl-9" placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)}/>
              </div>
              <ProductCategorySelect
                className="w-52"
                value={catFilter}
                onChange={setCatFilter}
                options={BASE_PRODUCT_CATEGORIES}
                allowEmpty
                emptyLabel="Categorias"
              />
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 yuisync-pos-products">
              {selectedProducts.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-[var(--primary)] mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--primary)', boxShadow: 'var(--shadow-primary)' }}/>
                    Itens Selecionados ({selectedProducts.length})
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {selectedProducts.map(p => (
                      <ProductCard 
                        key={p.id} 
                        product={p} 
                        cartItem={cartByProductId.get(p.id)}
                        onAdd={addToCart} 
                        onRemove={changeQty}
                      />
                    ))}
                  </div>
                  <div className="relative mt-8 h-px bg-gradient-to-r from-transparent via-[var(--border2)] to-transparent">
                    <div className="absolute left-1/2 -translate-x-1/2 -top-2 bg-background px-4">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--border2)]"/>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-muted flex items-center gap-2">
                    <Package size={12}/>
                    {prodLoading ? 'Carregando catálogo...' : `Itens Gerais (${otherProducts.length})`}
                  </h3>
                  {!prodLoading && otherProducts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted">
                        {productPageStart + 1}-{productPageEnd} de {otherProducts.length}
                      </span>
                      <label className="flex items-center gap-2 text-muted">
                        Exibir
                        <select
                          className="inp py-1.5 w-auto text-xs"
                          value={productPageSize}
                          onChange={(event) => setProductPageSize(Number(event.target.value))}
                        >
                          {PRODUCT_PAGE_SIZE_OPTIONS.map((size) => (
                            <option key={size} value={size}>{size}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm disabled:opacity-50"
                        disabled={currentProductPage <= 1}
                        onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                      >
                        Anterior
                      </button>
                      <span className="text-muted">
                        Pagina {currentProductPage} de {productTotalPages}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm disabled:opacity-50"
                        disabled={currentProductPage >= productTotalPages}
                        onClick={() => setProductPage((page) => Math.min(productTotalPages, page + 1))}
                      >
                        Proxima
                      </button>
                    </div>
                  )}
                </div>
                {prodLoading ? (
                  <div className="yuisync-pos-empty" role="status" aria-live="polite">
                    <span><RefreshCw size={22} className="animate-spin"/></span>
                    <p>Carregando catálogo...</p>
                    <small>Os produtos disponíveis aparecerão em instantes.</small>
                  </div>
                ) : otherProducts.length === 0 ? (
                  <div className="yuisync-pos-empty">
                    <span><Package size={22}/></span>
                    <p>Nenhum produto encontrado</p>
                    <small>Use a busca ou altere a categoria para localizar um item.</small>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {visibleOtherProducts.map(p => (
                        <ProductCard
                          key={p.id}
                          product={p}
                          cartItem={cartByProductId.get(p.id)}
                          onAdd={addToCart}
                          onRemove={changeQty}
                        />
                      ))}
                    </div>
                    {productTotalPages > 1 && (
                      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 text-xs">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm disabled:opacity-50"
                          disabled={currentProductPage <= 1}
                          onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                        >
                          Anterior
                        </button>
                        <span className="text-muted">
                          Pagina {currentProductPage} de {productTotalPages}
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm disabled:opacity-50"
                          disabled={currentProductPage >= productTotalPages}
                          onClick={() => setProductPage((page) => Math.min(productTotalPages, page + 1))}
                        >
                          Proxima
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
              </>
            )}
          </div>

          <div className="w-80 lg:w-96 min-h-0 flex flex-col bg-surface flex-shrink-0 border-l border-[var(--border2)] yuisync-pos-checkout">
            <div className="px-4 py-3 border-b border-[var(--border2)] font-display font-bold yuisync-pos-checkout-heading">
              <span>{tab === 'caixa' ? 'Fechamento da venda' : 'Resumo da venda'}</span>
              <span>{cart.reduce((count, item) => count + Number(item.quantity || 0), 0)} itens</span>
            </div>
            {tab !== 'caixa' && (
              <div className="min-h-0 max-h-[42vh] overflow-y-auto px-4 yuisync-pos-cart-list">
                {cart.length > 0 ? cart.map(item => <CartItem key={item.product_id} item={item} onQty={changeQty} onRemove={removeFromCart}/>) : (
                  <div className="yuisync-pos-cart-empty">
                    <ShoppingCart size={19}/>
                    <span>O carrinho está vazio</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 border-t border-[var(--border2)] space-y-4">
              <div className="relative" ref={searchRef}>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"/>
                  <input 
                    aria-label="Buscar cliente"
                    className="inp pl-9" 
                    placeholder="Cliente (Nome, Pet, CPF...)" 
                    value={customerSearch || customerName} 
                    onChange={e => {
                      setCustomerSearch(e.target.value)
                      setCustomerName(e.target.value)
                      setShowResults(true)
                      setPetId('')
                    }}
                    onFocus={() => setShowResults(true)}
                  />
                  {(customerSearch || customerName) && (
                    <button 
                      type="button"
                      aria-label="Limpar cliente selecionado"
                      title="Limpar cliente"
                      onClick={() => { setCustomerSearch(''); setCustomerName(''); setPetId(''); setShowResults(false); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-red-400 p-1"
                    >
                      <X size={14}/>
                    </button>
                  )}
                </div>

                {showResults && customerSearch && (
                  <div className={`absolute left-0 right-0 z-50 max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-card shadow-2xl animate-in fade-in ${
                    tab === 'caixa' ? 'top-full mt-2 slide-in-from-top-2' : 'bottom-full mb-2 slide-in-from-bottom-2'
                  }`}>
                    {filteredPets.length === 0 ? (
                      <div className="p-4 text-center">
                        <p className="text-xs text-muted">Novo cliente: <span className="font-bold text-[var(--primary)]">"{customerSearch}"</span></p>
                      </div>
                    ) : (
                      filteredPets.map(p => (
                        <button 
                          key={p.id}
                          onClick={() => {
                            setCustomerName(p.owner_name)
                            setPetId(p.id)
                            setCustomerSearch('')
                            setShowResults(false)
                          }}
                          className="w-full text-left p-3 hover:bg-white/5 border-b border-[var(--border2)] last:border-0 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-text">{p.owner_name}</p>
                            <span className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">{p.owner_cpf ? 'CPF ✅' : ''}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 truncate">
                            <span className="text-[10px] text-muted flex items-center gap-1">
                              <PawPrint size={10}/> {p.pet_name || 'Pet'} ({p.breed || 'SRD'})
                            </span>
                            <span className="text-[10px] text-muted">•</span>
                            <span className="text-[10px] text-muted">{p.phone}</span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {selectedPet && !showResults && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                    <Check size={12}/> Venda vinculada a {selectedPet.owner_name} · {selectedPet.pet_name || 'Pet'}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted">Vendedor / caixa</p>
                <select aria-label="Vendedor ou caixa" className="inp text-xs" value={sellerId} onChange={(event) => setSellerId(event.target.value)}>
                  <option value={auth?.profile?.id || ''}>{auth?.profile?.full_name || auth?.profile?.email || 'Usuario atual'}</option>
                  {sellers
                    .filter((seller) => seller.id !== auth?.profile?.id)
                    .map((seller) => (
                      <option key={seller.id} value={seller.id}>{seller.full_name || seller.email}</option>
                    ))}
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted">Origem da venda</p>
                <div className="grid grid-cols-2 gap-2">
                  {SALE_SOURCES.map(s => (
                    <button
                      key={s.value}
                      onClick={() => {
                        setSaleSource(s.value)
                        if (s.value !== 'whatsapp') setFulfillmentType('balcao')
                      }}
                      className={`flex items-center justify-center gap-2 py-2 rounded-xl border text-[10px] uppercase font-black transition-all ${saleSource === s.value ? 'text-gray-950 shadow-lg' : 'bg-white/5 border-[var(--border2)] text-muted'}`}
                      style={saleSource === s.value ? { backgroundColor: 'var(--primary)', borderColor: 'var(--primary)', boxShadow: 'var(--shadow-primary)' } : {}}
                    >
                      <s.icon size={14}/> {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {saleSource === 'whatsapp' && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted">Tipo operacional</p>
                  <div className="grid grid-cols-3 gap-2">
                    {FULFILLMENT_TYPES.map(option => (
                      <button
                        key={option.value}
                        onClick={() => setFulfillmentType(option.value)}
                        className={`py-2 rounded-xl border text-[10px] uppercase font-black transition-all ${fulfillmentType === option.value ? 'text-gray-950 shadow-lg' : 'bg-white/5 border-[var(--border2)] text-muted'}`}
                        style={fulfillmentType === option.value ? { backgroundColor: 'var(--primary)', borderColor: 'var(--primary)', boxShadow: 'var(--shadow-primary)' } : {}}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {fulfillmentType === 'entrega' && (<div className="space-y-2"><label className="inp-label">Motoboy da entrega</label><select className="inp" value={deliveryStaffKey} onChange={(event) => setDeliveryStaffKey(event.target.value)}><option value="">Definir depois na Equipe</option>{deliveryStaff.map((person) => <option key={person.key} value={person.key}>{person.name}</option>)}</select></div>)}
                  {fulfillmentType !== 'balcao' && (
                    <p className="text-[11px] text-muted leading-relaxed flex items-center gap-2"><Truck size={12}/> Essa venda vai abrir uma ordem automatica na aba de ordens.</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map(m => (
                  <button 
                    key={m.value} 
                    onClick={() => setPayment(m.value)} 
                    className={`flex flex-col items-center gap-1 py-2 rounded-xl border text-[10px] uppercase font-black transition-all ${payment === m.value ? 'text-gray-950 shadow-lg' : 'bg-white/5 border-[var(--border2)] text-muted'}`}
                    style={payment === m.value ? { backgroundColor: 'var(--primary)', borderColor: 'var(--primary)', boxShadow: 'var(--shadow-primary)' } : {}}
                  >
                    <m.icon size={14}/> {m.label}
                  </button>
                ))}
              </div>
              <div className="rounded-xl border border-[var(--border2)] bg-white/5 p-3 space-y-3">
                <label className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-widest text-muted">
                  <span>Fechamento rapido dividido</span>
                  <input
                    type="checkbox"
                    checked={paymentBreakdownEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked
                      setPaymentBreakdownEnabled(enabled)
                      if (enabled) {
                        const firstHalf = total ? Number((total / 2).toFixed(2)) : 0
                        setPaymentBreakdown([
                          createPaymentSplit(1, 'dinheiro', firstHalf ? firstHalf.toFixed(2) : ''),
                          createPaymentSplit(2, 'credito', total ? (total - firstHalf).toFixed(2) : ''),
                        ])
                      } else {
                        setPaymentBreakdown(DEFAULT_PAYMENT_SPLITS)
                      }
                    }}
                  />
                </label>

                {paymentBreakdownEnabled && (
                  <div className="space-y-3">
                    {paymentBreakdown.map((item, index) => (
                      <div key={item.id} className="grid grid-cols-[1fr_1fr_40px] gap-2">
                        <select
                          aria-label={`Forma de pagamento ${index + 1}`}
                          className="inp text-xs"
                          value={item.method}
                          onChange={(event) => updatePaymentSplit(item.id, 'method', event.target.value)}
                        >
                          {PAYMENT_METHODS.map((method) => (
                            <option key={method.value} value={method.value}>{method.label}</option>
                          ))}
                        </select>
                        <input
                          aria-label={`Valor do pagamento ${index + 1}`}
                          className="inp text-xs"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.amount}
                          onChange={(event) => updatePaymentSplit(item.id, 'amount', event.target.value)}
                          placeholder={`Valor ${index + 1}`}
                        />
                        <button
                          type="button"
                          aria-label={`Remover pagamento ${index + 1}`}
                          title="Remover pagamento"
                          onClick={() => removePaymentSplit(item.id)}
                          disabled={paymentBreakdown.length <= 2}
                          className="btn btn-secondary btn-sm justify-center"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={addPaymentSplit}
                        disabled={paymentBreakdown.length >= 4}
                        className="btn btn-secondary btn-sm"
                      >
                        <Plus size={12} /> Adicionar forma
                      </button>
                      <span className="text-[11px] text-muted">{paymentBreakdown.length}/4 formas</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted">Fechado</span>
                      <span className={Math.abs(breakdownTotal - total) <= 0.009 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                        {fmtCurrency(breakdownTotal)} / {fmtCurrency(total)}
                      </span>
                    </div>
                    {breakdownRemaining > 0 && (
                      <p className="text-[11px] text-amber-400">Falta distribuir {fmtCurrency(breakdownRemaining)}.</p>
                    )}
                  </div>
                )}
              </div>
              {(err || prodError) && (
                <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-400 flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{err || prodError}</span>
                </div>
              )}
              <div className="-mx-4 -mb-4 border-t border-[var(--border2)] bg-surface p-4 pt-3">
              <div className="rounded-2xl border border-[var(--border)] bg-card p-4 shadow-sm space-y-2">
                {deliveryFee > 0 && (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted flex items-center gap-2"><Truck size={14}/> Taxa de entrega</span>
                    <strong className="text-text">{fmtCurrency(deliveryFee)}</strong>
                  </div>
                )}
                <div className="flex items-end justify-between gap-3 border-t border-[var(--border2)] pt-2">
                  <span className="text-sm font-semibold text-muted">Total da venda</span>
                  <strong className="font-display text-2xl font-bold text-primary">{fmtCurrency(total)}</strong>
                </div>
              </div>
              <button 
                onClick={handleSell} 
                disabled={saving || !cart.length || (paymentBreakdownEnabled && Math.abs(breakdownTotal - total) > 0.009)} 
                className={`
                  btn mt-3 w-full py-4 rounded-xl flex items-center justify-center gap-2
                  font-display font-bold text-sm transition-all active:scale-[0.99]
                  ${saving || !cart.length 
                    ? 'bg-slate-100 text-muted cursor-not-allowed border border-[var(--border)]'
                    : 'btn-primary'}
                `}
              >
                {saving ? (
                  <RefreshCw size={20} className="animate-spin" />
                ) : (
                  <>
                    <Check size={19} strokeWidth={2.5} />
                    <span>Finalizar venda · {fmtCurrency(total)}</span>
                  </>
                )}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {successSale && (
        <SuccessModal
          sale={successSale}
          onClose={() => setSuccessSale(null)}
          onIssueFiscal={() => handleIssueFiscal(successSale.id, { updateSuccessModal: true })}
          issuingFiscal={issuingFiscalSaleId === successSale.id}
        />
      )}

      {upsellCandidate && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-6 z-[60] animate-in slide-in-from-bottom-4 duration-300">
           <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-4 shadow-2xl flex items-center gap-4 relative overflow-hidden group">
              {/* Partículas de brilho decorativas */}
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-12 -mt-12 group-hover:scale-150 transition-transform duration-500 blur-2xl"/>
              
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-white flex-shrink-0">
                <Tag size={20} className="animate-bounce-slow"/>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black text-gray-950/60 uppercase tracking-widest mb-0.5">Sugestão VIP / Upsell</p>
                <h4 className="text-sm font-black text-white leading-tight truncate">Adicionar {upsellCandidate.name}?</h4>
                <p className="text-[11px] text-white/80 font-bold">Apenas + {fmtCurrency(upsellCandidate.price)}</p>
              </div>

              <div className="flex gap-2 relative z-10">
                <button 
                  onClick={() => setUpsellCandidate(null)}
                  className="w-8 h-8 rounded-lg bg-gray-950/20 text-white hover:bg-gray-950/40 flex items-center justify-center transition-colors"
                >
                  <X size={14}/>
                </button>
                <button 
                  onClick={() => {
                    addToCart(upsellCandidate)
                    setUpsellCandidate(null)
                  }}
                  className="bg-white text-gray-950 px-4 py-2 rounded-xl text-xs font-black shadow-lg hover:scale-105 active:scale-95 transition-all"
                >
                  ADICIONAR
                </button>
              </div>
           </div>
        </div>
      )}
    </div>
  )
}


