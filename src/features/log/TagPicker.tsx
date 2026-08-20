import { useMemo, useState } from 'react'
import type { TagIndex } from '@/domain/models'
import { Icon } from '@/ui/Icon'

/** 태그 목록이 길어질 수 있으므로 검색과 '최근 사용'을 함께 제공합니다. */
export function TagPicker({
  tagIndex,
  selected,
  recentTagIds,
  onToggle,
}: {
  tagIndex: TagIndex
  selected: readonly string[]
  recentTagIds: readonly string[]
  onToggle: (tagId: string) => void
}) {
  const [query, setQuery] = useState('')

  const activeTags = useMemo(() => tagIndex.tags.filter((t) => !t.archived), [tagIndex])

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matching = needle
      ? activeTags.filter((t) => t.name.toLowerCase().includes(needle))
      : activeTags
    return tagIndex.categories
      .map((category) => ({
        category,
        tags: matching.filter((t) => t.categoryId === category.id),
      }))
      .filter((group) => group.tags.length > 0)
  }, [activeTags, tagIndex.categories, query])

  const orphans = useMemo(() => {
    const known = new Set(tagIndex.categories.map((c) => c.id))
    const needle = query.trim().toLowerCase()
    return activeTags.filter(
      (t) => !known.has(t.categoryId) && (!needle || t.name.toLowerCase().includes(needle)),
    )
  }, [activeTags, tagIndex.categories, query])

  const recent = useMemo(
    () =>
      recentTagIds
        .map((id) => tagIndex.byId.get(id))
        .filter((t): t is NonNullable<typeof t> => t != null && !t.archived)
        .slice(0, 8),
    [recentTagIds, tagIndex],
  )

  if (activeTags.length === 0) {
    return (
      <p className="hint">
        아직 태그가 없습니다. 태그 화면에서 추가하거나 준비된 세트를 불러오실 수 있습니다.
      </p>
    )
  }

  const renderChip = (tag: { id: string; name: string }) => {
    const isOn = selected.includes(tag.id)
    return (
      <button
        key={tag.id}
        type="button"
        className="chip"
        aria-pressed={isOn}
        onClick={() => onToggle(tag.id)}
      >
        {isOn && <Icon name="check" size={13} strokeWidth={2.5} />}
        {tag.name}
      </button>
    )
  }

  return (
    <div className="stack-sm">
      <div style={{ position: 'relative' }}>
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="태그 검색"
          aria-label="태그 검색"
          style={{ minHeight: 40, fontSize: 14 }}
        />
      </div>

      {!query && recent.length > 0 && (
        <div>
          <p className="section-label" style={{ marginBottom: 6 }}>
            최근 사용
          </p>
          <div className="row wrap" style={{ gap: 6 }}>
            {recent.map(renderChip)}
          </div>
        </div>
      )}

      {grouped.map(({ category, tags }) => (
        <div key={category.id}>
          <p className="section-label" style={{ marginBottom: 6 }}>
            {category.name}
          </p>
          <div className="row wrap" style={{ gap: 6 }}>
            {tags.map(renderChip)}
          </div>
        </div>
      ))}

      {orphans.length > 0 && (
        <div>
          <p className="section-label" style={{ marginBottom: 6 }}>
            분류 없음
          </p>
          <div className="row wrap" style={{ gap: 6 }}>
            {orphans.map(renderChip)}
          </div>
        </div>
      )}

      {query && grouped.length === 0 && orphans.length === 0 && (
        <p className="hint">'{query}'와 일치하는 태그가 없습니다.</p>
      )}
    </div>
  )
}
