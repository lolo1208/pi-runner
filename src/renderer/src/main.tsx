import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { TooltipProvider } from './components/ui/tooltip'

createRoot(document.getElementById('root')!).render(<React.StrictMode><TooltipProvider delayDuration={300}><App /></TooltipProvider></React.StrictMode>)
