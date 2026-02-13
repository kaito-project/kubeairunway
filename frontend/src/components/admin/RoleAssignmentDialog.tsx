import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { hubApi } from '@/lib/api'
import { useInstances } from '@/hooks/useInstances'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface RoleAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  userEmail: string
}

export function RoleAssignmentDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
}: RoleAssignmentDialogProps) {
  const queryClient = useQueryClient()
  const { data: instances } = useInstances()
  const [instanceId, setInstanceId] = useState('')
  const [role, setRole] = useState('')
  const [namespaces, setNamespaces] = useState('')

  const assignRole = useMutation({
    mutationFn: () =>
      hubApi.assignRole(userId, {
        instanceId,
        role,
        namespaces: namespaces.split(',').map((n) => n.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      onOpenChange(false)
      resetForm()
    },
  })

  const resetForm = () => {
    setInstanceId('')
    setRole('')
    setNamespaces('')
  }

  const canSubmit = instanceId && role && namespaces.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Role</DialogTitle>
          <DialogDescription>
            Assign an instance role to {userEmail}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="instance">Instance</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
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
            <Label htmlFor="role">Role</Label>
            <Select value={role} onValueChange={setRole}>
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
            <Label htmlFor="namespaces">Namespaces</Label>
            <Input
              id="namespaces"
              placeholder="default, ml-models, production"
              value={namespaces}
              onChange={(e) => setNamespaces(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of Kubernetes namespaces
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => assignRole.mutate()}
            disabled={!canSubmit || assignRole.isPending}
          >
            {assignRole.isPending ? 'Assigning...' : 'Assign Role'}
          </Button>
        </DialogFooter>

        {assignRole.isError && (
          <p className="text-sm text-destructive">
            {assignRole.error instanceof Error
              ? assignRole.error.message
              : 'Failed to assign role'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
