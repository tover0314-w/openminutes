import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { CapsuleApp } from './CapsuleApp'
import './styles.css'

const Root = window.location.hash === '#capsule' ? CapsuleApp : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
