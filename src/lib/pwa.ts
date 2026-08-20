/**
 * PWA 등록과 기록 리마인더.
 *
 * v3에는 알림이 전혀 없었습니다. 매일 반복하는 기록 앱에서 리마인더는 사실상
 * 유일한 재방문 장치입니다.
 *
 * 동작 범위를 솔직히 적어둡니다.
 * - Chrome/Android(설치된 PWA): Periodic Background Sync로 앱이 닫혀 있어도 알림이 갑니다.
 * - 그 외 브라우저: 앱을 열어 둔 동안에만 지정 시각에 알림이 뜹니다.
 * - iOS Safari: 홈 화면에 추가한 경우에만 알림 권한을 받을 수 있고, 백그라운드
 *   주기 실행은 지원되지 않습니다.
 * 서버 푸시(FCM)를 붙이면 전 플랫폼에서 동작하지만, 그 전에 env.ts에 적어둔
 * messagingSenderId 불일치를 먼저 확인해야 합니다.
 */

import type { DateKey } from '@/domain/date'
import { todayKey } from '@/domain/date'

const SW_URL = '/sw.js'
const PERIODIC_SYNC_TAG = 'dada-daily-reminder'
const MIN_PERIODIC_INTERVAL_MS = 12 * 60 * 60 * 1000

export interface ReminderSyncPayload {
  enabled: boolean
  time: string
  lastLoggedDate: DateKey | null
}

let registration: ServiceWorkerRegistration | null = null

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null
  try {
    registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' })
    return registration
  } catch (error) {
    console.warn('[dada] 서비스워커 등록 실패', error)
    return null
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

/** 서비스워커에 리마인더 설정을 전달합니다. */
export async function syncReminderSettings(payload: ReminderSyncPayload): Promise<void> {
  if (!isServiceWorkerSupported()) return
  const reg = registration ?? (await navigator.serviceWorker.ready.catch(() => null))
  if (!reg) return

  reg.active?.postMessage({ type: 'REMINDER_SETTINGS', payload })

  const periodicSync = (
    reg as ServiceWorkerRegistration & {
      periodicSync?: { register: (tag: string, options: { minInterval: number }) => Promise<void>; unregister: (tag: string) => Promise<void> }
    }
  ).periodicSync

  if (!periodicSync) return
  try {
    if (payload.enabled) {
      await periodicSync.register(PERIODIC_SYNC_TAG, { minInterval: MIN_PERIODIC_INTERVAL_MS })
    } else {
      await periodicSync.unregister(PERIODIC_SYNC_TAG)
    }
  } catch {
    // periodic-background-sync 권한이 없는 브라우저입니다. 아래 폴백이 처리합니다.
  }
}

/**
 * 앱이 열려 있는 동안의 폴백 리마인더.
 * 지정 시각을 지났고 오늘 기록이 없으면 한 번만 알립니다.
 */
export function startForegroundReminder(getState: () => ReminderSyncPayload): () => void {
  if (!isNotificationSupported()) return () => {}

  let notifiedDate: DateKey | null = null

  const tick = (): void => {
    const state = getState()
    if (!state.enabled) return
    if (Notification.permission !== 'granted') return

    const today = todayKey()
    if (notifiedDate === today) return
    if (state.lastLoggedDate === today) return

    const parts = state.time.split(':')
    const target = (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0)
    const now = new Date()
    if (now.getHours() * 60 + now.getMinutes() < target) return

    notifiedDate = today
    try {
      new Notification('오늘 기록이 아직 비어 있어요', {
        body: '기분과 에너지만 눌러도 1분이면 끝납니다.',
        icon: '/icon.svg',
        tag: PERIODIC_SYNC_TAG,
      })
    } catch (error) {
      console.warn('[dada] 알림 표시 실패', error)
    }
  }

  const timer = window.setInterval(tick, 60_000)
  tick()
  return () => window.clearInterval(timer)
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
