import { ReactNode, useState, useCallback, useEffect, createContext, useContext } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useProviderTheme } from '@/hooks/useProviderTheme'

interface SidebarContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within MainLayout')
  }
  return context
}

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  // Apply provider-specific theme colors
  useProviderTheme()
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  
  const toggle = useCallback(() => {
    setIsSidebarOpen(prev => !prev)
  }, [])

  // Close sidebar on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSidebarOpen) {
        setIsSidebarOpen(false)
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSidebarOpen])

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isSidebarOpen])

  const contextValue: SidebarContextValue = {
    isOpen: isSidebarOpen,
    setIsOpen: setIsSidebarOpen,
    toggle,
  }

  return (
    <SidebarContext.Provider value={contextValue}>
      <div className="flex h-screen bg-background">
        {/* Desktop sidebar - always visible */}
        <div className="hidden md:block">
          <Sidebar />
        </div>
        
        {/* Mobile sidebar overlay */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden animate-fade-in"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        
        {/* Mobile sidebar drawer */}
        <div 
          className={[
            'fixed inset-y-0 left-0 z-50 md:hidden',
            'transition-transform duration-300 ease-out-expo',
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
        >
          <Sidebar onNavigate={() => setIsSidebarOpen(false)} />
        </div>
        
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  )
}
