import type { DateKey } from '@/domain/date'
import type {
  CycleRecord,
  Entry,
  EntryMap,
  ExportBundle,
  Tag,
  TagCategory,
  UserProfile,
} from '@/domain/models'

export type Unsubscribe = () => void

export interface TagBundle {
  categories: TagCategory[]
  tags: Tag[]
}

export type ImportMode = 'merge' | 'replace'

export interface ImportResult {
  entries: number
  tags: number
  categories: number
  cycles: number
  skipped: number
}

/**
 * 앱이 저장소에 대해 아는 전부입니다.
 *
 * Firestore 호출은 이 인터페이스 뒤에만 존재합니다. 나중에 백엔드를 바꾸더라도
 * 화면 코드는 손대지 않습니다. v3는 컴포넌트가 `fsSave`를 직접 부르고 있어서
 * 이런 교체가 불가능했습니다.
 */
export interface TrackerRepository {
  // 프로필
  ensureProfile(uid: string, email: string | null): Promise<UserProfile>
  watchProfile(
    uid: string,
    onChange: (profile: UserProfile | null) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe
  updateProfile(uid: string, patch: Partial<UserProfile>): Promise<void>

  // 기록
  watchEntries(
    uid: string,
    onChange: (entries: EntryMap, fromCache: boolean) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe
  saveEntry(uid: string, entry: Entry): Promise<void>
  deleteEntry(uid: string, date: DateKey): Promise<void>
  deleteAllEntries(uid: string): Promise<void>

  // 태그
  watchTags(
    uid: string,
    onChange: (bundle: TagBundle) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe
  createCategory(uid: string, name: string): Promise<TagCategory>
  updateCategory(uid: string, id: string, patch: Partial<TagCategory>): Promise<void>
  /** 카테고리를 지우고 소속 태그를 다른 카테고리로 옮깁니다. */
  deleteCategory(uid: string, id: string, moveTagsTo: string | null): Promise<void>
  createTag(uid: string, name: string, categoryId: string): Promise<Tag>
  /** 이름 변경은 문서 1개 수정입니다. 과거 기록을 건드리지 않습니다. */
  updateTag(uid: string, id: string, patch: Partial<Tag>): Promise<void>
  setTagArchived(uid: string, id: string, archived: boolean): Promise<void>
  /** 완전 삭제. 모든 기록에서도 제거하므로 통계가 사라집니다. */
  purgeTag(uid: string, id: string): Promise<number>
  installPreset(uid: string, presetId: string): Promise<number>

  // 생리주기
  watchCycles(
    uid: string,
    onChange: (cycles: CycleRecord[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe
  saveCycle(uid: string, record: CycleRecord): Promise<void>
  createCycle(uid: string, startDate: DateKey, endDate: DateKey | null): Promise<CycleRecord>
  deleteCycle(uid: string, id: string): Promise<void>

  // 전체 데이터
  exportAll(uid: string): Promise<ExportBundle>
  importBundle(uid: string, bundle: ExportBundle, mode: ImportMode): Promise<ImportResult>
  /** 계정 삭제 전에 사용자 데이터를 모두 지웁니다. */
  purgeUserData(uid: string): Promise<void>
}
