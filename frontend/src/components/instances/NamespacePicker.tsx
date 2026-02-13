import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface NamespacePickerProps {
  instanceId: string
  allowedNamespaces: string[]
  value: string
  onChange: (namespace: string) => void
}

export function NamespacePicker({ allowedNamespaces, value, onChange }: NamespacePickerProps) {
  const showAll = allowedNamespaces.includes('*')
  const namespaces = showAll
    ? ['All namespaces', 'default']
    : allowedNamespaces

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select namespace" />
      </SelectTrigger>
      <SelectContent>
        {showAll && (
          <SelectItem value="*">All namespaces</SelectItem>
        )}
        {namespaces
          .filter((ns) => ns !== 'All namespaces' && ns !== '*')
          .map((ns) => (
            <SelectItem key={ns} value={ns}>
              {ns}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}
