import { RouterProvider } from '@octanejs/tanstack-router'
import { createElement, createRoot } from 'octane'
import { router } from './router'
import './style.css'

const container = document.getElementById('app')
if (container === null) throw new Error('Missing #app container.')

createRoot(container).render(() => createElement(RouterProvider, { router }))
