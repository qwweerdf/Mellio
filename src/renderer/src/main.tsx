import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/funnel-sans'
import '@fontsource-variable/funnel-display'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/500.css'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
