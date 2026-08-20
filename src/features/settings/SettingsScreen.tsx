import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '@/app/store'
import { APP_VERSION } from '@/lib/env'
import { authErrorMessage, reauthenticate, requestEmailVerification } from '@/lib/firebase'
import {
  isNotificationSupported,
  isStandalone,
  notificationPermission,
  requestNotificationPermission,
  syncReminderSettings,
} from '@/lib/pwa'
import { buildPhaseIndex, computeCycleStats } from '@/domain/cycle'
import type { PhaseIndex } from '@/domain/cycle'
import { exportCsv, exportJson, parseImport } from '@/data/exporters'
import type { ImportMode } from '@/data/repository'
import type { ExportBundle, ThemePreference, TrackedModules } from '@/domain/models'
import { Icon, type IconName } from '@/ui/Icon'
import { ConfirmSheet, SettingGroup, SettingRow, Sheet, Spinner, Toggle, useToast } from '@/ui/components'
import { LegalSheet } from '@/features/legal/LegalSheet'
import { MEDICAL_DISCLAIMER, PRIVACY, TERMS, type LegalDocument } from '@/features/legal/content'
import { CycleManager } from '@/features/cycle/CycleManager'

const MODULE_META: { key: keyof TrackedModules; icon: IconName; label: string; detail: string }[] = [
  { key: 'mood', icon: 'heart', label: '기분', detail: '1~5 척도' },
  { key: 'energy', icon: 'sparkles', label: '에너지', detail: '1~5 척도' },
  { key: 'sleep', icon: 'moon', label: '수면', detail: '수면 상태와 시간' },
  { key: 'cycle', icon: 'droplet', label: '생리주기', detail: '생리 시작·종료와 예측' },
]

const THEME_OPTIONS: { id: ThemePreference; label: string; icon: IconName }[] = [
  { id: 'system', label: '시스템', icon: 'settings' },
  { id: 'light', label: '밝게', icon: 'sun' },
  { id: 'dark', label: '어둡게', icon: 'moon' },
]

type Dialog =
  | { kind: 'none' }
  | { kind: 'import' }
  | { kind: 'deleteEntries' }
  | { kind: 'deleteAccount' }
  | { kind: 'cycles' }

export function SettingsScreen() {
  const { user, profile, entries, tagIndex, cycles, today, actions } = useApp()
  const toast = useToast()

  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [legalDoc, setLegalDoc] = useState<LegalDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [permission, setPermission] = useState(notificationPermission())
  const fileInput = useRef<HTMLInputElement>(null)

  const modules = profile?.modules ?? { mood: true, energy: true, sleep: true, cycle: false }
  const reminder = profile?.reminder ?? { enabled: false, time: '21:00' }

  const entryList = useMemo(() => Object.values(entries), [entries])
  const lastLoggedDate = useMemo(() => {
    const keys = Object.keys(entries).sort()
    return keys[keys.length - 1] ?? null
  }, [entries])

  const phaseIndexForExport = useMemo<PhaseIndex>(() => {
    if (!modules.cycle || entryList.length === 0) return new Map<string, never>()
    const dates = Object.keys(entries).sort()
    return buildPhaseIndex(cycles, dates[0] as string, dates[dates.length - 1] as string, {
      stats: computeCycleStats(cycles),
      today,
      predict: false,
    })
  }, [cycles, entries, entryList.length, modules.cycle, today])

  // 리마인더 설정이 바뀌면 서비스워커에도 알립니다.
  useEffect(() => {
    void syncReminderSettings({
      enabled: reminder.enabled,
      time: reminder.time,
      lastLoggedDate,
    })
  }, [reminder.enabled, reminder.time, lastLoggedDate])

  const setModule = async (key: keyof TrackedModules, value: boolean): Promise<void> => {
    const next = { ...modules, [key]: value }
    if (!Object.values(next).some(Boolean)) {
      toast.error('최소 한 가지는 켜 두셔야 합니다.')
      return
    }
    await actions.updateProfile({ modules: next })
  }

  const toggleReminder = async (enabled: boolean): Promise<void> => {
    if (enabled) {
      const result = await requestNotificationPermission()
      setPermission(result)
      if (result !== 'granted') {
        toast.error('브라우저에서 알림이 차단되어 있습니다. 사이트 설정에서 허용해주세요.')
        return
      }
    }
    await actions.updateProfile({ reminder: { ...reminder, enabled } })
  }

  const handleExport = async (format: 'json' | 'csv'): Promise<void> => {
    setBusy(true)
    try {
      const bundle: ExportBundle = await actions.exportAll()
      if (format === 'json') exportJson(bundle)
      else exportCsv(bundle.entries, tagIndex, phaseIndexForExport)
      toast.success(`${format.toUpperCase()} 파일을 내보냈습니다.`)
    } catch {
      // guard가 알립니다.
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async (): Promise<void> => {
    const parsed = parseImport(importText)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    setBusy(true)
    try {
      await actions.importBundle(parsed.bundle, importMode)
      for (const warning of parsed.warnings) toast.show(warning)
      setDialog({ kind: 'none' })
      setImportText('')
    } catch {
      // guard가 알립니다.
    } finally {
      setBusy(false)
    }
  }

  const readFile = (file: File): void => {
    const reader = new FileReader()
    reader.onload = () => setImportText(String(reader.result ?? ''))
    reader.onerror = () => toast.error('파일을 읽지 못했습니다.')
    reader.readAsText(file)
  }

  const tagCount = tagIndex.tags.filter((t) => !t.archived).length

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">설정</h1>
          <p className="page-subtitle">{user?.email ?? ''}</p>
        </div>
      </header>

      {user && !user.emailVerified && (
        <div className="notice notice-warn stack-sm" style={{ marginBottom: 16 }}>
          <span>이메일이 아직 확인되지 않았습니다. 비밀번호 재설정 등 계정 복구에 필요합니다.</span>
          <button
            type="button"
            className="btn btn-sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              try {
                await requestEmailVerification(user)
                toast.success('확인 메일을 보냈습니다.')
              } catch (error) {
                toast.error(authErrorMessage(error))
              }
            }}
          >
            확인 메일 보내기
          </button>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 22,
        }}
      >
        {[
          { value: entryList.length, label: '기록한 날', tone: 'accent' },
          { value: tagCount, label: '태그', tone: 'teal' },
          { value: cycles.length, label: '생리 기록', tone: 'rose' },
        ].map((item) => (
          <div
            key={item.label}
            className="card card-tight"
            style={{ textAlign: 'center', background: `var(--${item.tone}-soft)`, borderColor: 'transparent' }}
          >
            <div style={{ fontSize: 21, fontWeight: 700, color: `var(--${item.tone})` }}>{item.value}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2 }}>{item.label}</div>
          </div>
        ))}
      </div>

      <SettingGroup title="기록 항목">
        {MODULE_META.map((meta) => (
          <SettingRow
            key={meta.key}
            icon={meta.icon}
            label={meta.label}
            sub={meta.detail}
            as="div"
            right={
              <Toggle
                checked={modules[meta.key]}
                label={`${meta.label} 기록`}
                onChange={(next) => void setModule(meta.key, next)}
              />
            }
          />
        ))}
      </SettingGroup>

      {modules.cycle && (
        <SettingGroup title="생리주기">
          <SettingRow
            icon="droplet"
            label="생리 기록 관리"
            sub={`${cycles.length}건 · 평균 ${computeCycleStats(cycles).averageCycleLength}일 주기`}
            onClick={() => setDialog({ kind: 'cycles' })}
          />
        </SettingGroup>
      )}

      <SettingGroup title="알림">
        <SettingRow
          icon="bell"
          label="기록 리마인더"
          sub={
            permission === 'unsupported'
              ? '이 브라우저는 알림을 지원하지 않습니다'
              : permission === 'denied'
                ? '브라우저에서 알림이 차단되어 있습니다'
                : '그날 기록이 없으면 지정 시각에 알립니다'
          }
          as="div"
          right={
            <Toggle
              checked={reminder.enabled}
              label="기록 리마인더"
              disabled={permission === 'unsupported' || permission === 'denied'}
              onChange={(next) => void toggleReminder(next)}
            />
          }
        />
        {reminder.enabled && (
          <SettingRow
            icon="calendar"
            label="알림 시각"
            as="div"
            right={
              <input
                className="input"
                type="time"
                value={reminder.time}
                onChange={(e) => void actions.updateProfile({ reminder: { ...reminder, time: e.target.value } })}
                aria-label="알림 시각"
                style={{ width: 120, minHeight: 38, fontSize: 14 }}
              />
            }
          />
        )}
        {reminder.enabled && !isStandalone() && (
          <p className="hint" style={{ padding: '0 0 12px' }}>
            홈 화면에 추가하면 앱을 닫아둔 상태에서도 알림을 받을 가능성이 높아집니다. 브라우저 탭만
            열어둔 경우에는 앱이 실행 중일 때만 알립니다.
          </p>
        )}
        {!isNotificationSupported() && (
          <p className="hint" style={{ padding: '0 0 12px' }}>
            iOS에서는 홈 화면에 추가한 뒤에만 알림을 사용할 수 있습니다.
          </p>
        )}
      </SettingGroup>

      <SettingGroup title="화면">
        <SettingRow
          icon="sun"
          label="테마"
          as="div"
          right={
            <div className="row" style={{ gap: 4 }}>
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="chip"
                  aria-pressed={(profile?.theme ?? 'system') === option.id}
                  onClick={() => void actions.updateProfile({ theme: option.id })}
                  style={{ padding: '5px 9px', fontSize: 12 }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          }
        />
      </SettingGroup>

      <SettingGroup title="데이터">
        <SettingRow
          icon="download"
          label="JSON 내보내기"
          sub="기록·태그·생리 기록 전체 (다시 가져올 수 있는 형식)"
          onClick={() => void handleExport('json')}
        />
        <SettingRow
          icon="file"
          label="CSV 내보내기"
          sub="엑셀·구글 시트에서 바로 열립니다"
          onClick={() => void handleExport('csv')}
        />
        <SettingRow
          icon="upload"
          label="가져오기"
          sub="이전 버전(v3) JSON도 읽을 수 있습니다"
          onClick={() => setDialog({ kind: 'import' })}
        />
        <SettingRow
          icon="trash"
          label="모든 기록 삭제"
          sub="태그·생리 기록은 남습니다"
          danger
          onClick={() => setDialog({ kind: 'deleteEntries' })}
        />
      </SettingGroup>

      <SettingGroup title="계정">
        <SettingRow
          icon="logout"
          label="로그아웃"
          sub={user?.email ?? ''}
          onClick={() => void actions.signOut()}
        />
        <SettingRow
          icon="lock"
          label="계정 삭제"
          sub="계정과 모든 기록이 영구 삭제됩니다"
          danger
          onClick={() => {
            setDeletePassword('')
            setDeleteError('')
            setDialog({ kind: 'deleteAccount' })
          }}
        />
      </SettingGroup>

      <SettingGroup title="약관 및 정보">
        <SettingRow icon="file" label="이용약관" onClick={() => setLegalDoc(TERMS)} />
        <SettingRow icon="lock" label="개인정보처리방침" onClick={() => setLegalDoc(PRIVACY)} />
        <SettingRow icon="heart" label="위기 상담 안내" as="div" right={<span className="hint">109</span>} />
        <SettingRow icon="info" label="버전" as="div" right={<span className="hint">v{APP_VERSION}</span>} />
      </SettingGroup>

      <p className="hint" style={{ marginBottom: 8 }}>
        {MEDICAL_DISCLAIMER}
      </p>

      {/* ── 대화상자 ────────────────────────────────────────────────────── */}

      {dialog.kind === 'cycles' && <CycleManager onClose={() => setDialog({ kind: 'none' })} />}

      {dialog.kind === 'import' && (
        <Sheet
          title="데이터 가져오기"
          onClose={() => setDialog({ kind: 'none' })}
          footer={
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn grow" onClick={() => setDialog({ kind: 'none' })}>
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary grow"
                onClick={handleImport}
                disabled={busy || !importText.trim()}
              >
                {busy ? <Spinner size={16} /> : null} 가져오기
              </button>
            </div>
          }
        >
          <div className="stack">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) readFile(file)
              }}
            />
            <button type="button" className="btn btn-block" onClick={() => fileInput.current?.click()}>
              <Icon name="file" size={16} /> JSON 파일 선택
            </button>

            <div className="field">
              <label className="field-label" htmlFor="import-mode">
                기존 데이터 처리
              </label>
              <select
                id="import-mode"
                className="select"
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as ImportMode)}
              >
                <option value="merge">병합 — 같은 날짜는 덮어쓰고 나머지는 유지</option>
                <option value="replace">교체 — 기존 기록·태그를 모두 지우고 가져오기</option>
              </select>
            </div>

            {importMode === 'replace' && (
              <div className="notice notice-danger">
                교체를 선택하면 지금 저장된 기록·태그·생리 기록이 모두 삭제됩니다. 먼저 JSON으로
                내보내 두시기를 권합니다.
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="import-text">
                또는 JSON 직접 붙여넣기
              </label>
              <textarea
                id="import-text"
                className="textarea"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"format":"dada-tracker", ...} 또는 {"2025-01-01":{"mood":3}}'
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <p className="hint">
                형식을 검사한 뒤에만 저장합니다. 맞지 않는 항목은 건너뛰고 몇 건이 제외됐는지
                알려드립니다.
              </p>
            </div>
          </div>
        </Sheet>
      )}

      {dialog.kind === 'deleteEntries' && (
        <ConfirmSheet
          title="모든 기록을 삭제할까요?"
          description={`기분·에너지·수면·태그·메모가 담긴 ${entryList.length}일치 기록이 모두 지워집니다. 되돌릴 수 없습니다.\n\n태그 목록과 생리 기록은 남습니다.`}
          confirmLabel="모두 삭제"
          danger
          busy={busy}
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={async () => {
            setBusy(true)
            try {
              await actions.deleteAllEntries()
              toast.success('모든 기록을 삭제했습니다.')
              setDialog({ kind: 'none' })
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {dialog.kind === 'deleteAccount' && (
        <ConfirmSheet
          title="계정을 삭제할까요?"
          description={`계정과 함께 기록 ${entryList.length}일치, 태그 ${tagCount}개, 생리 기록 ${cycles.length}건이 영구 삭제됩니다. 복구할 수 없습니다.\n\n삭제 전에 데이터를 내보내 두시기를 권합니다.`}
          confirmLabel="영구 삭제"
          danger
          busy={busy}
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={async () => {
            if (!user) return
            setDeleteError('')
            setBusy(true)
            try {
              await reauthenticate(user, deletePassword)
              await actions.deleteAccount()
            } catch (error) {
              setDeleteError(authErrorMessage(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label" htmlFor="delete-password">
              확인을 위해 비밀번호를 입력해주세요
            </label>
            <input
              id="delete-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
            {deleteError && <p className="field-error">{deleteError}</p>}
          </div>
          <button
            type="button"
            className="btn btn-block"
            style={{ marginTop: 10 }}
            onClick={() => void handleExport('json')}
            disabled={busy}
          >
            <Icon name="download" size={16} /> 먼저 데이터 내보내기
          </button>
        </ConfirmSheet>
      )}

      {legalDoc && <LegalSheet document={legalDoc} onClose={() => setLegalDoc(null)} />}
    </div>
  )
}
