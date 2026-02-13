import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hubApi, instancesApi } from '@/lib/api'
import type { HubUser, HubInstance, HubEntraGroupMapping, HubAuthProvider } from '@/lib/api'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { RoleAssignmentDialog } from '@/components/admin/RoleAssignmentDialog'
import { SkeletonGrid } from '@/components/ui/skeleton'
import {
  Shield,
  Users,
  Server,
  Link2,
  KeyRound,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Pencil,
} from 'lucide-react'
import { useInstances } from '@/hooks/useInstances'

// Extended user type with roles from admin endpoint
interface AdminUser extends HubUser {
  roles?: Array<{
    instanceId: string
    role: string
    namespaces: string[]
  }>
  lastLoginAt?: string
}

// ============================================================================
// Users Tab
// ============================================================================

function UsersTab() {
  const queryClient = useQueryClient()
  const { data: users, isLoading, error } = useQuery<AdminUser[]>({
    queryKey: ['admin-users'],
    queryFn: () => hubApi.getUsers(),
  })
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [roleDialogUser, setRoleDialogUser] = useState<AdminUser | null>(null)

  const revokeRole = useMutation({
    mutationFn: ({ userId, instanceId, role }: { userId: string; instanceId: string; role: string }) =>
      hubApi.revokeRole(userId, instanceId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  if (isLoading) return <SkeletonGrid count={3} />
  if (error) return <p className="text-destructive">Failed to load users</p>

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="h-10 px-4 text-left font-medium text-muted-foreground w-8" />
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Email</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Display Name</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Provider</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Roles</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user) => {
              const isExpanded = expandedUser === user.id
              return (
                <tr key={user.id} className="group">
                  <td className="px-4 py-3" colSpan={6}>
                    <div>
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => setExpandedUser(isExpanded ? null : user.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <span className="flex-1 min-w-0 truncate">{user.email}</span>
                        <span className="flex-1 text-muted-foreground">{user.displayName}</span>
                        <Badge variant="outline" className="capitalize">{user.provider}</Badge>
                        <span className="text-muted-foreground text-xs">
                          {user.roles?.length ?? 0} role(s)
                        </span>
                        <Button size="sm" variant="outline" onClick={() => setRoleDialogUser(user)}>
                          <Plus className="h-3 w-3 mr-1" /> Assign Role
                        </Button>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 ml-8 space-y-2">
                          {user.roles && user.roles.length > 0 ? (
                            user.roles.map((r, i) => (
                              <div key={i} className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
                                <Badge>{r.role}</Badge>
                                <span className="text-muted-foreground">Instance: {r.instanceId}</span>
                                <span className="text-muted-foreground">
                                  Namespaces: {r.namespaces.join(', ')}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="ml-auto text-destructive hover:text-destructive"
                                  onClick={() => revokeRole.mutate({ userId: user.id, instanceId: r.instanceId, role: r.role })}
                                  disabled={revokeRole.isPending}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground">No roles assigned</p>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {(!users || users.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {roleDialogUser && (
        <RoleAssignmentDialog
          open={!!roleDialogUser}
          onOpenChange={(open) => !open && setRoleDialogUser(null)}
          userId={roleDialogUser.id}
          userEmail={roleDialogUser.email}
        />
      )}
    </div>
  )
}

// ============================================================================
// Instances Tab
// ============================================================================

function InstancesTab() {
  const queryClient = useQueryClient()
  const { data: instances, isLoading, refetch, isFetching } = useInstances()
  const [showRegister, setShowRegister] = useState(false)
  const [editInstance, setEditInstance] = useState<HubInstance | null>(null)
  const [form, setForm] = useState({ name: '', displayName: '', endpointUrl: '', credentialRef: '' })

  const registerInstance = useMutation({
    mutationFn: () => instancesApi.register(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      setShowRegister(false)
      setForm({ name: '', displayName: '', endpointUrl: '', credentialRef: '' })
    },
  })

  const updateInstance = useMutation({
    mutationFn: () =>
      instancesApi.update(editInstance!.id, {
        displayName: form.displayName || undefined,
        endpointUrl: form.endpointUrl || undefined,
        credentialRef: form.credentialRef || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] })
      setEditInstance(null)
    },
  })

  const deleteInstance = useMutation({
    mutationFn: (id: string) => instancesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances'] }),
  })

  if (isLoading) return <SkeletonGrid count={3} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {instances?.length ?? 0} instance(s) registered
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowRegister(true)}>
            <Plus className="h-4 w-4 mr-1" /> Register Instance
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Name</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Display Name</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Status</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Endpoint URL</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {instances?.map((inst) => (
              <tr key={inst.id} className="border-b last:border-b-0">
                <td className="px-4 py-3 font-medium">{inst.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{inst.displayName}</td>
                <td className="px-4 py-3">
                  <Badge variant={inst.status === 'connected' ? 'default' : 'outline'} className="capitalize">
                    {inst.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground text-xs font-mono truncate max-w-[200px]">
                  {inst.endpointUrl}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditInstance(inst)
                        setForm({ name: inst.name, displayName: inst.displayName, endpointUrl: inst.endpointUrl, credentialRef: '' })
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteInstance.mutate(inst.id)}
                      disabled={deleteInstance.isPending}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {(!instances || instances.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No instances registered
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Register Dialog */}
      <Dialog open={showRegister} onOpenChange={setShowRegister}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register Instance</DialogTitle>
            <DialogDescription>Add a new Kubernetes cluster instance</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="my-cluster"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                placeholder="My Production Cluster"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Endpoint URL</Label>
              <Input
                placeholder="https://cluster.example.com:6443"
                value={form.endpointUrl}
                onChange={(e) => setForm((f) => ({ ...f, endpointUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Credential Reference</Label>
              <Input
                placeholder="secret/my-kubeconfig"
                value={form.credentialRef}
                onChange={(e) => setForm((f) => ({ ...f, credentialRef: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegister(false)}>Cancel</Button>
            <Button
              onClick={() => registerInstance.mutate()}
              disabled={!form.name || !form.displayName || !form.endpointUrl || !form.credentialRef || registerInstance.isPending}
            >
              {registerInstance.isPending ? 'Registering...' : 'Register'}
            </Button>
          </DialogFooter>
          {registerInstance.isError && (
            <p className="text-sm text-destructive">
              {registerInstance.error instanceof Error ? registerInstance.error.message : 'Failed to register instance'}
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editInstance} onOpenChange={(open) => !open && setEditInstance(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Instance</DialogTitle>
            <DialogDescription>Update instance configuration</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Endpoint URL</Label>
              <Input
                value={form.endpointUrl}
                onChange={(e) => setForm((f) => ({ ...f, endpointUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Credential Reference</Label>
              <Input
                placeholder="Leave empty to keep current"
                value={form.credentialRef}
                onChange={(e) => setForm((f) => ({ ...f, credentialRef: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditInstance(null)}>Cancel</Button>
            <Button onClick={() => updateInstance.mutate()} disabled={updateInstance.isPending}>
              {updateInstance.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================================
// Group Mappings Tab
// ============================================================================

function GroupMappingsTab() {
  const queryClient = useQueryClient()
  const { data: mappings, isLoading } = useQuery<HubEntraGroupMapping[]>({
    queryKey: ['admin-group-mappings'],
    queryFn: () => hubApi.getGroupMappings(),
  })
  const { data: instances } = useInstances()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    entraGroupId: '',
    entraGroupName: '',
    instanceId: '',
    role: '',
    namespaces: '',
  })

  const createMapping = useMutation({
    mutationFn: () =>
      hubApi.createGroupMapping({
        ...form,
        namespaces: form.namespaces.split(',').map((n) => n.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-group-mappings'] })
      setShowAdd(false)
      setForm({ entraGroupId: '', entraGroupName: '', instanceId: '', role: '', namespaces: '' })
    },
  })

  const deleteMapping = useMutation({
    mutationFn: (id: string) => hubApi.deleteGroupMapping(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-group-mappings'] }),
  })

  if (isLoading) return <SkeletonGrid count={3} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Map Entra ID groups to instance roles
        </p>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Mapping
        </Button>
      </div>

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Group Name</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Group ID</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Instance</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Role</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Namespaces</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {mappings?.map((m) => (
              <tr key={m.id} className="border-b last:border-b-0">
                <td className="px-4 py-3 font-medium">{m.entraGroupName}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs font-mono">{m.entraGroupId}</td>
                <td className="px-4 py-3 text-muted-foreground">{m.instanceId}</td>
                <td className="px-4 py-3"><Badge className="capitalize">{m.role}</Badge></td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{m.namespaces.join(', ')}</td>
                <td className="px-4 py-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteMapping.mutate(m.id)}
                    disabled={deleteMapping.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
            {(!mappings || mappings.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No group mappings configured
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Group Mapping</DialogTitle>
            <DialogDescription>Map an Entra ID group to an instance role</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Group Name</Label>
              <Input
                placeholder="ML Engineers"
                value={form.entraGroupName}
                onChange={(e) => setForm((f) => ({ ...f, entraGroupName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Group ID</Label>
              <Input
                placeholder="00000000-0000-0000-0000-000000000000"
                value={form.entraGroupId}
                onChange={(e) => setForm((f) => ({ ...f, entraGroupId: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Instance</Label>
              <Select value={form.instanceId} onValueChange={(v) => setForm((f) => ({ ...f, instanceId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select instance" />
                </SelectTrigger>
                <SelectContent>
                  {instances?.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.displayName || inst.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="deployer">Deployer</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Namespaces</Label>
              <Input
                placeholder="default, ml-models"
                value={form.namespaces}
                onChange={(e) => setForm((f) => ({ ...f, namespaces: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Comma-separated list</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button
              onClick={() => createMapping.mutate()}
              disabled={
                !form.entraGroupId || !form.entraGroupName || !form.instanceId ||
                !form.role || !form.namespaces.trim() || createMapping.isPending
              }
            >
              {createMapping.isPending ? 'Creating...' : 'Create Mapping'}
            </Button>
          </DialogFooter>
          {createMapping.isError && (
            <p className="text-sm text-destructive">
              {createMapping.error instanceof Error ? createMapping.error.message : 'Failed to create mapping'}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================================
// Auth Providers Tab
// ============================================================================

function AuthProvidersTab() {
  const { data: providers, isLoading } = useQuery<HubAuthProvider[]>({
    queryKey: ['admin-auth-providers'],
    queryFn: () => hubApi.getAuthProviders(),
  })

  if (isLoading) return <SkeletonGrid count={2} />

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configured OAuth providers for user authentication
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {providers?.map((p) => (
          <div key={p.type} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium capitalize">{p.type}</h3>
              <Badge variant={p.enabled ? 'default' : 'outline'}>
                {p.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
            {p.clientId && (
              <p className="text-xs text-muted-foreground font-mono">
                Client ID: {p.clientId.slice(0, 8)}...
              </p>
            )}
          </div>
        ))}
        {(!providers || providers.length === 0) && (
          <p className="text-muted-foreground col-span-2 text-center py-8">
            No auth providers configured
          </p>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Admin Page
// ============================================================================

export function AdminPage() {
  const [tab, setTab] = useState('users')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" />
          Administration
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage users, instances, and access control
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="users">
            <Users className="h-4 w-4 mr-1.5" />
            Users
          </TabsTrigger>
          <TabsTrigger value="instances">
            <Server className="h-4 w-4 mr-1.5" />
            Instances
          </TabsTrigger>
          <TabsTrigger value="groups">
            <Link2 className="h-4 w-4 mr-1.5" />
            Group Mappings
          </TabsTrigger>
          <TabsTrigger value="providers">
            <KeyRound className="h-4 w-4 mr-1.5" />
            Auth Providers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="instances">
          <InstancesTab />
        </TabsContent>
        <TabsContent value="groups">
          <GroupMappingsTab />
        </TabsContent>
        <TabsContent value="providers">
          <AuthProvidersTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
