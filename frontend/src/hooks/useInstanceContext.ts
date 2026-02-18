import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import React from 'react';

const INSTANCE_STORAGE_KEY = 'kubefoundry_instance_id';
const INSTANCE_NAME_STORAGE_KEY = 'kubefoundry_instance_name';

export interface InstanceContextType {
  currentInstanceId: string | null;
  currentInstanceName: string | null;
  setCurrentInstance: (id: string | null, name?: string | null) => void;
  clearInstance: () => void;
}

export const InstanceContext = createContext<InstanceContextType>({
  currentInstanceId: null,
  currentInstanceName: null,
  setCurrentInstance: () => {},
  clearInstance: () => {},
});

export function useInstanceContext() {
  return useContext(InstanceContext);
}

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize from URL param first, then localStorage
  const urlInstanceId = searchParams.get('instance');
  const [instanceId, setInstanceId] = useState<string | null>(
    urlInstanceId || localStorage.getItem(INSTANCE_STORAGE_KEY)
  );
  const [instanceName, setInstanceName] = useState<string | null>(
    localStorage.getItem(INSTANCE_NAME_STORAGE_KEY)
  );

  // Sync URL param to state on first load
  useEffect(() => {
    if (urlInstanceId && urlInstanceId !== instanceId) {
      setInstanceId(urlInstanceId);
      localStorage.setItem(INSTANCE_STORAGE_KEY, urlInstanceId);
    }
  }, [urlInstanceId]);

  const setCurrentInstance = useCallback(
    (id: string | null, name?: string | null) => {
      setInstanceId(id);
      setInstanceName(name ?? null);
      if (id) {
        localStorage.setItem(INSTANCE_STORAGE_KEY, id);
        if (name) localStorage.setItem(INSTANCE_NAME_STORAGE_KEY, name);
        setSearchParams(prev => {
          const next = new URLSearchParams(prev);
          next.set('instance', id);
          return next;
        });
      } else {
        localStorage.removeItem(INSTANCE_STORAGE_KEY);
        localStorage.removeItem(INSTANCE_NAME_STORAGE_KEY);
        setSearchParams(prev => {
          const next = new URLSearchParams(prev);
          next.delete('instance');
          return next;
        });
      }
    },
    [setSearchParams],
  );

  const clearInstance = useCallback(() => {
    setCurrentInstance(null);
  }, [setCurrentInstance]);

  return React.createElement(
    InstanceContext.Provider,
    { value: { currentInstanceId: instanceId, currentInstanceName: instanceName, setCurrentInstance, clearInstance } },
    children,
  );
}
