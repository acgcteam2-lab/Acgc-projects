import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerServiceWorker } from './pwa.js'
import { installGlobalModalBehavior } from './lib/globalModalBehavior.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
installGlobalModalBehavior()
