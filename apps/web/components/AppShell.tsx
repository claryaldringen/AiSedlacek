'use client';

import { Sidebar, type Workspace } from './Sidebar';

interface AppShellProps {
  children: React.ReactNode;
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  onWorkspaceSelect: (id: string) => void;
  onCreateWorkspace: () => void;
  loadingWorkspaces: boolean;
}

export function AppShell({
  children,
  workspaces,
  selectedWorkspaceId,
  onWorkspaceSelect,
  onCreateWorkspace,
  loadingWorkspaces,
}: AppShellProps): React.JSX.Element {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar with user info + workspaces */}
      <Sidebar
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        onWorkspaceSelect={onWorkspaceSelect}
        onCreateWorkspace={onCreateWorkspace}
        loadingWorkspaces={loadingWorkspaces}
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex flex-1 flex-col overflow-hidden bg-slate-50">{children}</main>
      </div>
    </div>
  );
}
