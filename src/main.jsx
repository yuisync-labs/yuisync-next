import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './performance.css'
import './petshopClientCards.css'
import './metaWhatsappReview.css'
import './product-ui-clean.css'
import App from './App'
import { SiteLegalFooterPortal } from './public/components/SiteLegalFooterPortal'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <SiteLegalFooterPortal />
  </StrictMode>
)
