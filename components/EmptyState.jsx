import { BadgeCheck } from 'lucide-react'

export default function EmptyState({ title, detail }) {
  return (
    <div className="empty">
      <BadgeCheck size={22} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}
