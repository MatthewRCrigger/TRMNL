/** Entry point for the visual harness. Loaded only by harness.html. */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Harness } from './Harness'
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/grid.css'
import '../styles/app.css'
import './harness.css'

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
