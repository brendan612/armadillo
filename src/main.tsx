import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import './index.css'
import App from './App.tsx'

const convexUrl = import.meta.env.VITE_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {convex ? (
      <ConvexAuthProvider client={convex}>
        <App />
      </ConvexAuthProvider>
    ) : (
      <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
        <h1>Armadillo</h1>
        <p>Set <code>VITE_CONVEX_URL</code> in your environment to run the app.</p>
      </div>
    )}
  </StrictMode>,
)
