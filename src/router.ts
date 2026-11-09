import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@octanejs/tanstack-router/compiled'

const isInRoot = typeof window !== 'undefined' && window.location.pathname === '/'

const createRouteComponent = (path: string) => lazyRouteComponent(() => import(path))

const appRoute = lazyRouteComponent(() => import('./App.btsx'))

function createAppRouteTree() {
  const rootRoute = createRootRoute({
    component: appRoute,
    notFoundComponent: lazyRouteComponent(() => import('./pages/404.btsx'))
  })

  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: createRouteComponent('./pages/TodosPage.btsx')
  })

  // const dashboardIndexRoute = createRoute({
  //   getParentRoute: () => dashboardRoute,
  //   component: createRouteComponent('./pages/AppRoot.btsx')
  // })

  const textRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/text',
    component: createRouteComponent('./pages/TextPage.btsx')
  })

  const voiceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/voice',
    component: createRouteComponent('./pages/VoicePage.btsx')
  })

  return rootRoute.addChildren([dashboardRoute, textRoute, voiceRoute])
}

const routeTree = createAppRouteTree()

export const router = createRouter({ defaultPreload: 'intent', routeTree, scrollRestoration: true })

declare module '@tanstack/router-core' {
  interface Register {
    router: typeof router
  }
}
