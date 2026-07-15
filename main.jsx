import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const clientPortalRoute = window.location.pathname === '/client-portal.html'
const ProductScreen = lazy(clientPortalRoute
  ? () => import('./ClientPortal.jsx')
  : () => import('./App.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<main className="route-loading" aria-busy="true"><span>Loading Contractor.AI</span></main>}>
      <ProductScreen />
    </Suspense>
  </StrictMode>,
)
