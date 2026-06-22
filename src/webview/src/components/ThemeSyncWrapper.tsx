import React, { useEffect } from 'react';

export const ThemeSyncWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    const observer = new MutationObserver(() => {
      // Just forces a re-render if vscode theme class changes
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return <>{children}</>;
};
