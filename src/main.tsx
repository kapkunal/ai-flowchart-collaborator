import ReactDOM from 'react-dom/client'
// Required from Excalidraw 0.18 on: the ESM build no longer injects its own
// stylesheet. Without this the editor renders completely unstyled.
// Imported here rather than in App.tsx so Vitest never has to parse CSS.
import '@excalidraw/excalidraw/index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
