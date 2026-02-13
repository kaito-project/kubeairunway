import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import React from 'react';

export interface InstanceContextType {
  currentInstanceId: string | null;
  currentInstanceName: string | null;
  setCurrentInstance: (id: string | null, name?: string | null) => void;
}

export const InstanceContext = createContext<InstanceContextType>({
  currentInstanceId: null,
  currentInstanceName: null,
  setCurrentInstance: () => {},
});

export function useInstanceContext() {
  return useContext(InstanceContext);
}

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [instanceName, setInstanceName] = useState<string | null>(null);

  const instanceId = searchParams.get('instance') || null;

  const setCurrentInstance = useCallback(
    (id: string | null, name?: string | null) => {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        if (id) {
          next.set('instance', id);
        } else {
          next.delete('instance');
        }
        return next;
      });
      setInstanceName(name ?? null);
    },
    [setSearchParams],
  );

  return React.createElement(
    InstanceContext.Provider,
    { value: { currentInstanceId: instanceId, currentInstanceName: instanceName, setCurrentInstance } },
    children,
  );
}
