/**
 * Firebase 웹 설정.
 *
 * 웹 API 키는 비밀이 아닙니다(클라이언트 번들에 반드시 노출됩니다). 실제 접근
 * 제어는 `firestore.rules`가 담당합니다. 그래도 프로젝트를 갈아끼울 수 있도록
 * 환경변수를 우선 읽습니다.
 *
 * ⚠️ 확인 필요: v3 설정의 messagingSenderId(400037233155)와 appId에 포함된
 * 프로젝트 번호(400037233255)가 한 자리 다릅니다. 지금 Auth/Firestore는
 * appId만 쓰므로 증상이 없지만, FCM 푸시를 붙이면 문제가 됩니다.
 * Firebase 콘솔의 값으로 재확인한 뒤 VITE_FIREBASE_MESSAGING_SENDER_ID로
 * 덮어쓰시기 바랍니다. 임의로 고치지 않고 원본 값을 그대로 두었습니다.
 */

const FALLBACK = {
  apiKey: 'AIzaSyC6imI3t0uA7qZr0rUC3i1AbRtpXMQeDzQ',
  authDomain: 'dadatracker.firebaseapp.com',
  projectId: 'dadatracker',
  storageBucket: 'dadatracker.firebasestorage.app',
  messagingSenderId: '400037233155',
  appId: '1:400037233255:web:3eba39c919dd46115cc436',
} as const

function pick(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

export const firebaseConfig = {
  apiKey: pick(import.meta.env.VITE_FIREBASE_API_KEY, FALLBACK.apiKey),
  authDomain: pick(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, FALLBACK.authDomain),
  projectId: pick(import.meta.env.VITE_FIREBASE_PROJECT_ID, FALLBACK.projectId),
  storageBucket: pick(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, FALLBACK.storageBucket),
  messagingSenderId: pick(
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    FALLBACK.messagingSenderId,
  ),
  appId: pick(import.meta.env.VITE_FIREBASE_APP_ID, FALLBACK.appId),
}

export const APP_VERSION = '4.0.0'
export const TERMS_VERSION = '2026-08-01'
export const PRIVACY_VERSION = '2026-08-01'
