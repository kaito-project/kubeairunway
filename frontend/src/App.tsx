import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { MainLayout } from './components/layout/MainLayout'
import { ModelsPage } from './pages/ModelsPage'
import { DeployPage } from './pages/DeployPage'
import { DeploymentsPage } from './pages/DeploymentsPage'
import { DeploymentDetailsPage } from './pages/DeploymentDetailsPage'
import { SettingsPage } from './pages/SettingsPage'
import { LoginPage } from './pages/LoginPage'
import { HuggingFaceCallbackPage } from './pages/HuggingFaceCallbackPage'
import { InstancesPage } from './pages/InstancesPage'
import { AdminPage } from './pages/AdminPage'
import { Toaster } from './components/ui/toaster'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAuth } from './hooks/useAuth'
import { InstanceProvider, useInstanceContext } from './hooks/useInstanceContext'

/**
 * Protected route wrapper - redirects to login if auth is enabled and not authenticated
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, authEnabled } = useAuth();
  const location = useLocation();

  // Still loading auth state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Auth not enabled - allow access
  if (!authEnabled) {
    return <>{children}</>;
  }

  // Auth enabled but not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated - render children
  return <>{children}</>;
}

/**
 * Hub mode: redirect to /instances when no instance is selected on the root route
 */
function HubHomeRedirect({ children }: { children: React.ReactNode }) {
  const { hubMode } = useAuth();
  const { currentInstanceId } = useInstanceContext();

  if (hubMode && !currentInstanceId) {
    return <Navigate to="/instances" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Login page - always accessible */}
      <Route path="/login" element={<LoginPage />} />
      
      {/* OAuth callback - always accessible (handles auth flow) */}
      <Route path="/oauth/callback/huggingface" element={<HuggingFaceCallbackPage />} />
      
      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout>
              <HubHomeRedirect>
                <ModelsPage />
              </HubHomeRedirect>
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/deploy/:modelId"
        element={
          <ProtectedRoute>
            <MainLayout>
              <DeployPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/deployments"
        element={
          <ProtectedRoute>
            <MainLayout>
              <DeploymentsPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/deployments/:name"
        element={
          <ProtectedRoute>
            <MainLayout>
              <DeploymentDetailsPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <MainLayout>
              <SettingsPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/installation"
        element={<Navigate to="/settings?tab=runtimes" replace />}
      />
      <Route
        path="/instances"
        element={
          <ProtectedRoute>
            <MainLayout>
              <InstancesPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <MainLayout>
              <AdminPage />
            </MainLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <InstanceProvider>
          <AppRoutes />
        </InstanceProvider>
        <Toaster />
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
