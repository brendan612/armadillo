import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import App from './App'
import './index.css'
import { convexClient } from './lib/convexClient'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexAuthProvider client={convexClient}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
)
