import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { StationProvider } from './state/StationProvider'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StationProvider>
      <App />
    </StationProvider>
  </StrictMode>,
)
