import { useMemo, useState } from 'react'
import { useApp } from '@/app/store'
import { fullLabel } from '@/domain/date'
import { objectParticle } from '@/domain/korean'
import { resolveEntryTagIds, type Tag } from '@/domain/models'
import { TAG_PRESETS, isRiskTagName } from '@/domain/tagPresets'
import { Icon } from '@/ui/Icon'
import { ConfirmSheet, Sheet, Spinner, useToast } from '@/ui/components'

type EditTarget = { tag: Tag } | null

export function TagsScreen({ onBack }: { onBack?: () => void } = {}) {
  const { entries, tagIndex, actions } = useApp()
  const toast = useToast()

  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditTarget>(null)
  const [editName, setEditName] = useState('')
  const [editCategoryId, setEditCategoryId] = useState('')
  const [confirmPurge, setConfirmPurge] = useState<Tag | null>(null)
  const [newTagName, setNewTagName] = useState<Record<string, string>>({})
  const [newCategoryName, setNewCategoryName] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [busy, setBusy] = useState(false)

  /** 태그별 사용 횟수. 전체 기록을 한 번만 훑습니다. */
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of Object.values(entries)) {
      for (const id of resolveEntryTagIds(entry, tagIndex)) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    return counts
  }, [entries, tagIndex])

  const history = useMemo(() => {
    if (!selectedTagId) return []
    return Object.values(entries)
      .filter((entry) => resolveEntryTagIds(entry, tagIndex).includes(selectedTagId))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 40)
  }, [selectedTagId, entries, tagIndex])

  const categories = tagIndex.categories
  const orphanCategoryId = '__orphan__'

  const groups = useMemo(() => {
    const known = new Set(categories.map((c) => c.id))
    const visible = tagIndex.tags.filter((t) => showArchived || !t.archived)
    const result = categories.map((category) => ({
      id: category.id,
      name: category.name,
      tags: visible.filter((t) => t.categoryId === category.id),
    }))
    const orphans = visible.filter((t) => !known.has(t.categoryId))
    if (orphans.length > 0) {
      result.push({ id: orphanCategoryId, name: '분류 없음', tags: orphans })
    }
    return result
  }, [categories, tagIndex.tags, showArchived])

  const archivedCount = tagIndex.tags.filter((t) => t.archived).length

  const startEdit = (tag: Tag): void => {
    setEditing({ tag })
    setEditName(tag.name)
    setEditCategoryId(tag.categoryId)
    setSelectedTagId(null)
  }

  const saveEdit = async (): Promise<void> => {
    if (!editing) return
    setBusy(true)
    try {
      const { tag } = editing
      if (editName.trim() && editName.trim() !== tag.name) await actions.renameTag(tag.id, editName)
      if (editCategoryId && editCategoryId !== tag.categoryId) await actions.moveTag(tag.id, editCategoryId)
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  const addTag = async (categoryId: string): Promise<void> => {
    const name = newTagName[categoryId]?.trim()
    if (!name) return
    setBusy(true)
    try {
      const created = await actions.createTag(name, categoryId)
      if (created) setNewTagName((prev) => ({ ...prev, [categoryId]: '' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      {onBack && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onBack}
          style={{ paddingLeft: 0, marginTop: 16 }}
        >
          <Icon name="chevronLeft" size={16} /> 설정
        </button>
      )}
      <header className="page-header" style={onBack ? { paddingTop: 8 } : undefined}>
        <div>
          <h1 className="page-title">관찰 항목</h1>
          <p className="page-subtitle">
            {tagIndex.tags.filter((t) => !t.archived).length}개 사용 중
            {archivedCount > 0 ? ` · 보관 ${archivedCount}개` : ''}
          </p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowPresets(true)}>
          <Icon name="plus" size={15} strokeWidth={2} /> 세트 추가
        </button>
      </header>

      <p className="hint" style={{ marginBottom: 20, lineHeight: 1.8 }}>
        관찰할 항목을 기록해두면 시간이 지나면서 기분·에너지·수면·주기와 어떤 관계가 있는지
        살펴봅니다. 항목을 누르면 기록한 날짜를 볼 수 있고, 연필 버튼으로 이름과 분류를 바꿉니다.
        이름을 바꿔도 과거 기록은 그대로 따라옵니다.
      </p>

      {/* 태그 사용 기록 */}
      {selectedTagId && (
        <section className="card stack-sm" style={{ marginBottom: 16, animation: 'fade-in 0.2s var(--ease)' }}>
          <div className="row-between">
            <strong style={{ fontSize: 14 }}>
              '{tagIndex.byId.get(selectedTagId)?.name}' 사용 날짜 ({usage.get(selectedTagId) ?? 0}회)
            </strong>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedTagId(null)}
              aria-label="닫기"
            >
              <Icon name="x" size={16} />
            </button>
          </div>
          {history.length === 0 ? (
            <p className="hint">아직 사용한 날짜가 없습니다.</p>
          ) : (
            <div className="stack-sm" style={{ maxHeight: 280, overflowY: 'auto' }}>
              {history.map((entry) => (
                <div
                  key={entry.date}
                  style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '9px 11px' }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{fullLabel(entry.date, false)}</div>
                  {entry.memo && (
                    <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.6 }}>
                      {entry.memo}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {groups.length === 0 && (
        <p className="empty">
          아직 관찰 항목이 없습니다.
          <br />
          준비된 세트를 불러오거나 카테고리부터 만들어보세요.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.id} style={{ marginBottom: 20 }}>
          <div className="row-between" style={{ marginBottom: 8 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>{group.name}</h2>
            {group.id !== orphanCategoryId && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const next = window.prompt('카테고리 이름', group.name)
                  if (next && next.trim() !== group.name) void actions.renameCategory(group.id, next)
                }}
              >
                <Icon name="pencil" size={13} />
              </button>
            )}
          </div>

          <div className="row wrap" style={{ gap: 6 }}>
            {group.tags.map((tag) => {
              const count = usage.get(tag.id) ?? 0
              return (
                <span key={tag.id} className="row" style={{ gap: 2 }}>
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={selectedTagId === tag.id}
                    onClick={() => setSelectedTagId(selectedTagId === tag.id ? null : tag.id)}
                    style={tag.archived ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}
                  >
                    {isRiskTagName(tag.name) && (
                      <span style={{ color: 'var(--amber)' }} title="위기 자원 안내가 함께 표시됩니다">
                        <Icon name="heart" size={12} />
                      </span>
                    )}
                    {tag.name}
                    {count > 0 && <span className="chip-count">{count}</span>}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ minHeight: 34, padding: '4px 6px' }}
                    aria-label={`${tag.name} 편집`}
                    onClick={() => startEdit(tag)}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                </span>
              )
            })}
          </div>

          {group.id !== orphanCategoryId && (
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <input
                className="input"
                value={newTagName[group.id] ?? ''}
                onChange={(e) => setNewTagName((prev) => ({ ...prev, [group.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addTag(group.id)
                }}
                placeholder="항목 추가"
                aria-label={`${group.name}에 항목 추가`}
                style={{ minHeight: 38, fontSize: 13.5 }}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void addTag(group.id)}
                disabled={busy || !newTagName[group.id]?.trim()}
              >
                추가
              </button>
            </div>
          )}
        </section>
      ))}

      <div className="stack-sm">
        {addingCategory ? (
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void actions.createCategory(newCategoryName).then((created) => {
                    if (created) {
                      setNewCategoryName('')
                      setAddingCategory(false)
                    }
                  })
                }
                if (e.key === 'Escape') setAddingCategory(false)
              }}
              placeholder="카테고리 이름"
              autoFocus
              style={{ minHeight: 40 }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                void actions.createCategory(newCategoryName).then((created) => {
                  if (created) {
                    setNewCategoryName('')
                    setAddingCategory(false)
                  }
                })
              }
            >
              추가
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setAddingCategory(false)}>
              취소
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-block"
            style={{ borderStyle: 'dashed' }}
            onClick={() => setAddingCategory(true)}
          >
            <Icon name="plus" size={15} /> 카테고리 추가
          </button>
        )}

        {archivedCount > 0 && (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setShowArchived((v) => !v)}>
            <Icon name="archive" size={15} />
            {showArchived ? '보관된 항목 숨기기' : `보관된 항목 ${archivedCount}개 보기`}
          </button>
        )}
      </div>

      {/* 태그 편집 */}
      {editing && (
        <Sheet title="관찰 항목 편집" onClose={() => setEditing(null)}>
          <div className="stack">
            <div className="field">
              <label className="field-label" htmlFor="tag-name">
                이름
              </label>
              <input
                id="tag-name"
                className="input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
              />
              <p className="hint">
                이름을 바꿔도 이 태그가 붙은 기록 {usage.get(editing.tag.id) ?? 0}건은 그대로
                유지됩니다.
              </p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="tag-category">
                분류
              </label>
              <select
                id="tag-category"
                className="select"
                value={editCategoryId}
                onChange={(e) => setEditCategoryId(e.target.value)}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
                {!categories.some((c) => c.id === editCategoryId) && (
                  <option value={editCategoryId}>분류 없음</option>
                )}
              </select>
            </div>

            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn grow" onClick={() => setEditing(null)} disabled={busy}>
                취소
              </button>
              <button type="button" className="btn btn-primary grow" onClick={saveEdit} disabled={busy}>
                {busy ? <Spinner size={16} /> : null} 저장
              </button>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '4px 0' }} />

            <button
              type="button"
              className="btn btn-block"
              onClick={async () => {
                await actions.setTagArchived(editing.tag.id, !editing.tag.archived)
                toast.success(editing.tag.archived ? '보관을 해제했습니다.' : '태그를 보관했습니다.')
                setEditing(null)
              }}
            >
              <Icon name="archive" size={15} />
              {editing.tag.archived ? '보관 해제' : '보관하기 (통계는 유지)'}
            </button>
            <p className="hint">
              보관하면 기록 화면의 선택 목록에서만 빠집니다. 과거 기록과 통계는 그대로 남습니다.
            </p>

            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                setConfirmPurge(editing.tag)
                setEditing(null)
              }}
            >
              <Icon name="trash" size={15} /> 완전 삭제
            </button>
          </div>
        </Sheet>
      )}

      {confirmPurge && (
        <ConfirmSheet
          title={`'${confirmPurge.name}'${objectParticle(confirmPurge.name)} 완전히 삭제할까요?`}
          description={`이 태그가 붙은 기록 ${usage.get(confirmPurge.id) ?? 0}건에서도 함께 제거되고, 관련 통계가 사라집니다. 되돌릴 수 없습니다.\n\n통계를 남기고 목록에서만 빼시려면 '보관하기'를 사용하세요.`}
          confirmLabel="완전 삭제"
          danger
          busy={busy}
          onCancel={() => setConfirmPurge(null)}
          onConfirm={async () => {
            setBusy(true)
            try {
              const affected = await actions.purgeTag(confirmPurge.id)
              toast.success(`태그를 삭제했습니다. 기록 ${affected}건에서 제거되었습니다.`)
              setConfirmPurge(null)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {showPresets && (
        <Sheet title="관찰 항목 세트 추가" onClose={() => setShowPresets(false)}>
          <div className="stack">
            <p className="hint">
              이미 있는 이름은 건너뜁니다. 기존 태그와 기록에는 영향을 주지 않습니다.
            </p>
            {TAG_PRESETS.map((preset) => {
              const count = preset.categories.reduce((sum, c) => sum + c.tags.length, 0)
              return (
                <div key={preset.id} className="card stack-sm">
                  <div className="row-between">
                    <strong style={{ fontSize: 14 }}>{preset.name}</strong>
                    <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                      {count}개
                    </span>
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                    {preset.description}
                  </p>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        const added = await actions.installPreset(preset.id)
                        toast.success(
                          added > 0 ? `태그 ${added}개를 추가했습니다.` : '추가할 새 태그가 없습니다.',
                        )
                        setShowPresets(false)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    이 세트 불러오기
                  </button>
                </div>
              )
            })}
          </div>
        </Sheet>
      )}
    </div>
  )
}
