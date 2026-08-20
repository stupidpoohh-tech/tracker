import { Sheet } from '@/ui/components'
import type { LegalDocument } from './content'

export function LegalSheet({ document, onClose }: { document: LegalDocument; onClose: () => void }) {
  return (
    <Sheet title={document.title} onClose={onClose}>
      <p className="hint" style={{ marginBottom: 16 }}>
        시행일 {document.version}
      </p>
      <div className="stack-lg">
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{section.heading}</h3>
            <div className="stack-sm">
              {section.paragraphs.map((p, i) => (
                <p key={i} style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.75 }}>
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  )
}
