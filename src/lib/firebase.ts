import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
import { firebaseConfig } from './env'

export const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
void setPersistence(auth, browserLocalPersistence)

/**
 * 오프라인 영속성을 켭니다.
 *
 * v3는 이게 없어서 (1) 지하철·비행기에서 저장이 실패했고 (2) 앱을 열 때마다
 * 전체 기록을 서버에서 다시 읽었습니다. IndexedDB 캐시 + onSnapshot 조합이면
 * 기기당 최초 1회만 전량을 받고 이후에는 변경분만 내려받습니다.
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
})

export type { User }

export const onAuth = (cb: (user: User | null) => void) => onAuthStateChanged(auth, cb)
export const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(auth, email, password)
export const signUp = (email: string, password: string) =>
  createUserWithEmailAndPassword(auth, email, password)
export const logOut = () => signOut(auth)
export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email)
export const requestEmailVerification = (user: User) => sendEmailVerification(user)
export const changePassword = (user: User, next: string) => updatePassword(user, next)

/** 계정 삭제 전 재인증. Firebase는 최근 로그인 없이는 삭제를 거부합니다. */
export async function reauthenticate(user: User, password: string): Promise<void> {
  if (!user.email) throw new Error('이메일 계정이 아닙니다')
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
}

export const removeAccount = (user: User) => deleteUser(user)

/** Firebase Auth 에러 코드를 사용자 문구로 옮깁니다. */
export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? ''
  const table: Record<string, string> = {
    'auth/user-not-found': '등록되지 않은 이메일입니다.',
    'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
    'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    'auth/weak-password': '비밀번호가 너무 짧습니다. 8자 이상으로 설정해주세요.',
    'auth/too-many-requests': '시도가 너무 잦습니다. 잠시 후 다시 시도해주세요.',
    'auth/network-request-failed': '네트워크 연결을 확인해주세요.',
    'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤 진행해주세요.',
    'auth/missing-password': '비밀번호를 입력해주세요.',
  }
  if (table[code]) return table[code] as string
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
}
