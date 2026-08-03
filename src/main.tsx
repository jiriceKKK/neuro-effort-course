import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { UpdatePrompt } from './app/UpdatePrompt'
import './styles/global.css'

const container = document.getElementById('root')
if (container === null) throw new Error('Kořenový element #root nebyl nalezen.')

createRoot(container).render(
  <StrictMode>
    <App />
    <UpdatePrompt />
  </StrictMode>,
)
