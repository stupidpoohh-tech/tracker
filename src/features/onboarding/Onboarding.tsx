import { useState } from 'react'
import { useApp } from '@/app/store'
import { Icon, type IconName } from '@/ui/Icon'
import { Spinner, Toggle, useToast } from '@/ui/components'
import { LegalSheet } from '@/features/legal/LegalSheet'
import { MEDICAL_DISCLAIMER, PRIVACY, TERMS, type LegalDocument } from '@/features/legal/content'
import { TAG_PRESETS } from '@/domain/tagPresets'
import type { TrackedModules } from '@/domain/models'

const MODULE_META: { key: keyof TrackedModules; icon: IconName; label: string; detail: string }[] = [
  { key: 'mood', icon: 'heart', label: '기분', detail: '1~5 척도로 하루의 기분을 남깁니다' },
  { key: 'energy', icon: 'sparkles', label: '에너지', detail: '기분과 따로 움직이는 활력을 봅니다' },
  { key: 'sleep', icon: 'moon', label: '수면', detail: '적게·잘·많이 잤는지와 수면 시간' },
  {
    key: 'cycle',
    icon: 'droplet',
    label: '생리주기',
    detail: '생리 시작·종료를 기록하고 다음 주기를 예측합니다',
  },
]

/**
 * 첫 실행 온보딩.
 *
 * v3는 개인용이라 이런 단계가 없었고, 생리주기가 모두에게 강제로 켜져 있었으며
 * 71개 태그가 한꺼번에 노출됐습니다. 다인 서비스에서는 무엇을 기록할지부터
 * 사용자가 고를 수 있어야 합니다.
 */
export function Onboarding() {
  const { profile, actions } = useApp()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [agreed, setAgreed] = useState(profile?.consent?.sensitiveDataConsent ?? false)
  const [modules, setModules] = useState<TrackedModules>(
    profile?.modules ?? { mood: true, energy: true, sleep: true, cycle: false },
  )
  const [presetId, setPresetId] = useState<string | null>('starter')
  const [busy, setBusy] = useState(false)
  const [legalDoc, setLegalDoc] = useState<LegalDocument | null>(null)

  const atLeastOneModule = Object.values(modules).some(Boolean)

  const finish = async (): Promise<void> => {
    setBusy(true)
    try {
      await actions.acceptConsent()
      await actions.updateProfile({ modules, onboardedAt: Date.now() })
      if (presetId) {
        const added = await actions.installPreset(presetId)
        if (added > 0) toast.success(`태그 ${added}개를 추가했습니다.`)
      }
    } catch {
      // guard가 이미 토스트를 띄웁니다.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page" style={{ paddingTop: 32, paddingBottom: 32, minHeight: '100dvh' }}>
      <div className="row" style={{ gap: 4, marginBottom: 28 }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= step ? 'var(--accent)' : 'var(--border)',
              transition: 'background 0.25s var(--ease)',
            }}
          />
        ))}
      </div>

      {step === 0 && (
        <div className="stack-lg" style={{ animation: 'fade-in 0.25s var(--ease)' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.35 }}>
              기분·에너지·수면·생리주기를
              <br />한 곳에서 봅니다
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 10, lineHeight: 1.7 }}>
              따로 보면 안 보이던 관계가 함께 놓으면 드러납니다. 시작 전에 두 가지만 확인해주세요.
            </p>
          </div>

          <div className="notice notice-info">{MEDICAL_DISCLAIMER}</div>

          <div className="card stack-sm">
            <p style={{ fontSize: 14, fontWeight: 700 }}>민감정보 수집·이용 동의 (필수)</p>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.75 }}>
              이 앱이 저장하는 정신건강 상태와 생리주기 기록은 개인정보보호법상 민감정보입니다.
              기록의 저장과 본인에게 보여줄 통계 계산에만 사용하며, 광고·프로파일링·모델 학습에는
              사용하지 않습니다. 언제든지 전체 데이터를 내려받거나 계정을 삭제하실 수 있습니다.
            </p>
            <label className="row" style={{ alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 13, lineHeight: 1.6 }}>
                위 내용을 확인했으며 민감정보 수집·이용에 동의합니다.
              </span>
            </label>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLegalDoc(TERMS)}>
                이용약관
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLegalDoc(PRIVACY)}>
                개인정보처리방침
              </button>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!agreed}
            onClick={() => setStep(1)}
          >
            다음
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="stack-lg" style={{ animation: 'fade-in 0.25s var(--ease)' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>무엇을 기록하시겠어요?</h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.7 }}>
              고른 항목만 기록 화면에 나타납니다. 나중에 설정에서 언제든 바꿀 수 있습니다.
            </p>
          </div>

          <div className="stack-sm">
            {MODULE_META.map((meta) => (
              <div key={meta.key} className="card card-tight row" style={{ gap: 12 }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: modules[meta.key] ? 'var(--accent-soft)' : 'var(--surface-2)',
                    color: modules[meta.key] ? 'var(--accent)' : 'var(--text-3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon name={meta.icon} size={18} />
                </span>
                <span className="grow">
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{meta.label}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--text-3)', marginTop: 1 }}>
                    {meta.detail}
                  </span>
                </span>
                <Toggle
                  checked={modules[meta.key]}
                  label={`${meta.label} 기록`}
                  onChange={(next) => setModules((prev) => ({ ...prev, [meta.key]: next }))}
                />
              </div>
            ))}
          </div>

          {!atLeastOneModule && (
            <p className="field-error">최소 한 가지는 선택해주세요.</p>
          )}

          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn" onClick={() => setStep(0)}>
              이전
            </button>
            <button
              type="button"
              className="btn btn-primary grow"
              disabled={!atLeastOneModule}
              onClick={() => setStep(2)}
            >
              다음
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack-lg" style={{ animation: 'fade-in 0.25s var(--ease)' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>태그를 어떻게 시작할까요?</h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.7 }}>
              태그는 그날 있었던 증상이나 상태를 한 번에 고르는 목록입니다. 나중에 얼마든지 추가·수정할
              수 있습니다.
            </p>
          </div>

          <div className="stack-sm">
            {TAG_PRESETS.map((preset) => {
              const count = preset.categories.reduce((sum, c) => sum + c.tags.length, 0)
              const selected = presetId === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPresetId(preset.id)}
                  className="card"
                  style={{
                    textAlign: 'left',
                    borderColor: selected ? 'var(--accent)' : 'var(--border)',
                    background: selected ? 'var(--accent-soft)' : 'var(--surface)',
                  }}
                >
                  <div className="row-between">
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{preset.name}</span>
                    <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
                      {count}개
                    </span>
                  </div>
                  <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.65 }}>
                    {preset.description}
                  </p>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setPresetId(null)}
              className="card"
              style={{
                textAlign: 'left',
                borderColor: presetId === null ? 'var(--accent)' : 'var(--border)',
                background: presetId === null ? 'var(--accent-soft)' : 'var(--surface)',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700 }}>직접 만들기</span>
              <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 4 }}>
                빈 목록에서 시작하고 필요한 태그만 추가합니다.
              </p>
            </button>
          </div>

          <div className="row" style={{ gap: 10 }}>
            <button type="button" className="btn" onClick={() => setStep(1)} disabled={busy}>
              이전
            </button>
            <button type="button" className="btn btn-primary grow" onClick={finish} disabled={busy}>
              {busy ? <Spinner size={16} /> : null}
              {busy ? '준비 중...' : '시작하기'}
            </button>
          </div>
        </div>
      )}

      {legalDoc && <LegalSheet document={legalDoc} onClose={() => setLegalDoc(null)} />}
    </div>
  )
}
