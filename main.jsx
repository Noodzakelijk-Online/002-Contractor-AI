import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ClientPortal from './ClientPortal.jsx'

const clientPortalRoute = window.location.pathname === '/client-portal.html'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {clientPortalRoute ? <ClientPortal /> : <App />}
  </StrictMode>,
)
