import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { AppProvider } from './app/store'
import { ErrorBoundary, ToastProvider } from './ui/components'
import './ui/base.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 요소를 찾을 수 없습니다')

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
